import { catalogAvatar, resolveExpertModelForContext } from "@shared/expert-catalog";
import { billingErrorResponse, billingUnavailable } from "./billing-errors";
import type { Express, Request, Response } from "express";
import express from "express";
import { createServer, type Server } from "http";
import { storage, DeliverableConflictError } from "./storage";
import { setupAuth } from "./auth";
import { callOpenRouterAPI, callPerplexityAPI, generateSystemPrompt, getExpertResponse, generateInsights, generateClosingSynthesis, resolveAuxModel } from "./ai";
import { processMessageTurnBased, InteractionOrchestrator, getConversationState, callTheQuestion, getFarmerFileIntent, persistAutonomySettings, restorePausedFromSnapshot, isConversationBusy, discardConversationState } from "./orchestrator";
import { encryptApiKey, decryptApiKey, maskApiKey } from "./crypto";
import multer from "multer";
import path from "path";
import fs from "fs";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import Stripe from "stripe";
import { WebSocketServer, type RawData } from "ws";
import { InsertConversation, InsertExpert, InsertMessage, Message, type File, type SessionCredit, insertCompanyProfileSchema } from "@shared/schema";
import { z } from "zod";
import { extractMentions } from "@shared/mentions";
import { buildVCalendar } from "@shared/ics";
import { calendarEventsSchema, type CalendarDraft } from "@shared/calendar-draft";
import { inspectCalendar } from "./calendar-files";
import { extractScheduleRows, parseIsoDate, nextMondayFrom, resolveRowStartDate, buildRowSummary } from "@shared/schedule-extract";
import { generateComprehensiveMarkdown } from './export-utils';
import { isDuplicateUserSubmission } from './text-similarity';
import { format } from 'date-fns';
import { getTierLimits, sessionCreditLimits, isSessionKind } from './tiers';
import { checkHouseKeyCall, checkMessageAllowance, currentUsagePeriod, BOARDROOM_FRONTIER_MODEL_ALLOWLIST, FRONTIER_MODEL_LABELS, houseKeyModelsForTier, UsageCapError, monthlyAiBudgetUsd, BUDGET_EXHAUSTED_NOTICE } from './usage-caps';
import { PLAN_PRICING, SESSION_PRICING } from '@shared/pricing';
import {
  checkoutUrls,
  parseCheckoutRequest,
  resolveReturnOrigin,
  resolveSessionPriceId,
  resolveSubscriptionPriceId,
  tierForSubscriptionPriceId,
} from './billing-plans';

class OpenQuestionAnswerConflictError extends Error {}
const rememberedAnswerTurnStarts = new Map<number, number>();
const ANSWER_TURN_RETRY_DEDUPE_MS = 60_000;

function authorizedFileDownloadUrl(file: Pick<File, "conversationId" | "id">): string {
  return `/api/protected/conversations/${file.conversationId}/files/${file.id}/download`;
}

function clientFileRecord(file: File) {
  return { ...file, fileUrl: authorizedFileDownloadUrl(file) };
}

function getStoredUploadPath(file: File): string | undefined {
  if (!file.fileUrl.startsWith("/uploads/")) return undefined;
  const filename = file.fileUrl.slice("/uploads/".length);
  if (!filename || path.basename(filename) !== filename) return undefined;
  return path.join(process.cwd(), "uploads", filename);
}

function isRetrievalOnlyRequest(content: string): boolean {
  const intent = getFarmerFileIntent(content);
  return intent === "retrieve" || (intent === "no_file" && /\b(?:link|download)\b/i.test(content));
}

function buildStoredDeliverableReply(content: string, files: File[]): string {
  if (files.length === 0) {
    return "I couldn't find a saved deliverable in this conversation yet. You can open the Files pane to check, or ask the board to create one.";
  }

  const lowerContent = content.toLowerCase();
  const requestedKind = ["sop", "calendar", "spreadsheet", "csv", "chart", "plan", "budget", "script"]
    .find(kind => lowerContent.includes(kind));
  const matchingKind = requestedKind
    ? files.filter(file => file.filename.toLowerCase().includes(requestedKind))
    : files;
  const currentKindMatches = matchingKind.filter(file => file.deliverableId);
  const kindMatches = currentKindMatches.length > 0 ? currentKindMatches : matchingKind;
  const ordered = [...kindMatches].sort(
    (a, b) => (b.uploadedAt?.getTime() ?? 0) - (a.uploadedAt?.getTime() ?? 0),
  );
  if (ordered.length === 0) {
    const available = [...files].sort((a, b) => (b.uploadedAt?.getTime() ?? 0) - (a.uploadedAt?.getTime() ?? 0));
    return `I couldn't find a saved ${requestedKind} to link. Here are the current saved deliverables instead:\n\n${available.map(file => `- [${file.filename}](${authorizedFileDownloadUrl(file)})`).join("\n")}`;
  }
  const latestRequested = /\b(?:latest|most recent|current)\b/.test(lowerContent);
  const selected = ordered.length === 1 || latestRequested ? [ordered[0]] : ordered;
  const intro = selected.length === 1
    ? "Here is the saved deliverable:"
    : "I found these saved deliverables. Choose the one you meant: ";
  const links = selected.map(file => {
    const version = file.version == null ? "" : ` (v${file.version}${file.supersededAt ? ", superseded" : ", current"})`;
    return `- [${file.filename}](${authorizedFileDownloadUrl(file)})${version}`;
  });
  return `${intro}\n\n${links.join("\n")}`;
}

function answerTurnWasRecentlyDispatched(messageId: number): boolean {
  const dispatchedAt = rememberedAnswerTurnStarts.get(messageId);
  if (dispatchedAt === undefined) return false;
  if (Date.now() - dispatchedAt > ANSWER_TURN_RETRY_DEDUPE_MS) {
    rememberedAnswerTurnStarts.delete(messageId);
    return false;
  }
  return true;
}

// Load dev config
let devConfig: any = null;
try {
  const devConfigPath = path.join(process.cwd(), "server", "dev-config.json");
  if (fs.existsSync(devConfigPath)) {
    devConfig = JSON.parse(fs.readFileSync(devConfigPath, "utf-8"));
  }
} catch (e) {
  console.warn("Could not load dev-config.json");
}

// Initialize file upload middleware
const upload = multer({
  dest: path.join(process.cwd(), "uploads"),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Stripe setup
let stripe: Stripe | null = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2023-10-16" as any, // Type assertion to fix type mismatch
  });
} else {
  console.warn("No STRIPE_SECRET_KEY provided. Stripe functionality will be unavailable.");
}

// Stripe's expanded invoice is typed as a string-or-object union. Keep the
// legacy expanded payment_intent response shape while narrowing that union.
function getSubscriptionClientSecret(subscription: Stripe.Subscription): string | null {
  const invoice = subscription.latest_invoice;
  if (!invoice || typeof invoice === "string") return null;

  const expandedInvoice = invoice as Stripe.Invoice & {
    payment_intent?: string | Stripe.PaymentIntent | null;
  };
  const paymentIntent = expandedInvoice.payment_intent;
  return paymentIntent && typeof paymentIntent !== "string"
    ? paymentIntent.client_secret
    : null;
}

// Development mode flag - uses NODE_ENV to determine dev vs production
const DEVELOPMENT_MODE = process.env.NODE_ENV !== "production";

/**
 * The one-time session credit funding a conversation, if any. Credits are
 * attached at creation and apply for the conversation's whole life.
 */
async function creditForConversation(conversationId: number | null | undefined): Promise<SessionCredit | undefined> {
  if (!conversationId) return undefined;
  try {
    return await storage.getSessionCreditByConversationId(conversationId);
  } catch (error) {
    console.warn("[CREDITS] could not load conversation credit:", (error as Error).message);
    return undefined;
  }
}

/** Seat/message limits that actually apply to this conversation. */
async function effectiveLimits(userTier: string, conversationId?: number | null) {
  const credit = await creditForConversation(conversationId);
  if (credit) {
    const limits = sessionCreditLimits(credit.kind);
    return {
      credit,
      name: limits.name,
      maxExperts: limits.maxExperts,
      maxMessages: limits.maxMessages,
      allowPaidModels: true,
      allowFrontierModels: limits.allowFrontierModels,
    };
  }
  return { credit: undefined, ...getTierLimits(userTier) };
}

/**
 * House-key model gate for a specific request. Frontier models are Boardroom
 * only; a Boardroom Session credit unlocks them for that conversation.
 * BYOK may pick anything. Monthly budgets are checked at call time so a paid
 * customer gets the graceful paid-fallback/overage path instead of a hard
 * failure; only a credit's own hard cap is enforced here.
 */
async function houseKeyModelDenial(userId: number, userTier: string, model: string, conversationId?: number | null) {
  if (await storage.getUserApiKey(userId)) return null;
  const credit = await creditForConversation(conversationId);
  const denial = checkHouseKeyCall(
    userTier,
    model,
    0,
    credit ? { kind: credit.kind as "fast" | "boardroom", spentUsd: credit.aiSpendUsd } : undefined,
  );
  // Overage is not a rejection: the provider runs the paid fallback model.
  return denial?.code === "ai_budget_overage" ? null : denial;
}


// G6/G13: body for PUT /api/protected/conversations/:id — update title,
// council charter, and optional turn budget. Strict: unknown fields are
// rejected, not silently dropped.
// Title caps at 500 chars (the length the create path already accepts);
// charter caps hard at 2,000 chars.
const updateConversationSchema = z.object({
  title: z.string().trim().min(1, "Title cannot be empty").max(500, "Title must be at most 500 characters").optional(),
  charter: z.string().max(2000, "Charter must be at most 2,000 characters").nullable().optional(),
  turnBudget: z.number().int().min(0, "Turn budget must be 0 or an integer from 1 to 100").max(100, "Turn budget must be at most 100").nullable().optional(),
});

// Extract and VERIFY the express-session id from a WS upgrade request's
// Cookie header. express-session signs the value as `s:<sessionId>.<signature>`
// where signature = base64(HMAC-SHA256(secret, sessionId)) with trailing "="
// padding stripped (cookie-signature's sign()). The signature must be
// verified, never merely stripped — a leaked or guessed raw session id must
// not be enough to mint an authenticated socket. `cookie-signature` is a
// transitive dep of express-session but ships no type declarations, so the
// equivalent check is hand-rolled with node:crypto and compared with
// timingSafeEqual. Mirrors cookie-signature's unsign(): the sid/signature
// split happens at the LAST dot of the signed portion.
function getVerifiedSessionIdFromUpgradeRequest(req: { headers: { cookie?: string } }): string | null {
  const secret = process.env.SESSION_SECRET;
  // No secret configured means express-session signed cookies with a random
  // per-process string we cannot reproduce — fail closed.
  if (!secret) return null;

  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== "connect.sid") continue;
    let value: string;
    try {
      value = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
    if (!value.startsWith("s:")) return null;
    const signed = value.slice(2);
    const dot = signed.lastIndexOf(".");
    if (dot === -1) return null;
    const sid = signed.slice(0, dot);
    const providedSignature = signed.slice(dot + 1);
    if (!sid || !providedSignature) return null;

    const expectedSignature = createHmac("sha256", secret)
      .update(sid)
      .digest("base64")
      .replace(/=+$/, "");
    const expected = Buffer.from(expectedSignature);
    const provided = Buffer.from(providedSignature);
    // timingSafeEqual throws on length mismatch; unequal length is already a
    // failed verification.
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      return null;
    }
    return sid;
  }
  return null;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Liveness/readiness for docker-compose and uptime checks (README-SELF-HOST).
  app.get("/api/health", async (_req, res) => {
    let database: "ok" | "memory" | "error" = process.env.DATABASE_URL ? "ok" : "memory";
    if (database === "ok") {
      try { await storage.getUser(0); } catch { database = "error"; }
    }
    res.status(database === "error" ? 503 : 200).json({ status: database === "error" ? "degraded" : "ok", database, uptimeSeconds: Math.round(process.uptime()) });
  });

  // Setup authentication routes
  setupAuth(app);

  // Keep historical /uploads links working, but resolve them through their
  // file record so an authenticated user must own the parent conversation.
  app.get("/uploads/:filename", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Authentication required" });
      const filename = path.basename(req.params.filename);
      const file = await storage.getFileByUrl(`/uploads/${filename}`);
      if (!file) return res.status(404).json({ message: "File not found" });
      const conversation = await storage.getConversation(file.conversationId);
      if (!conversation || conversation.userId !== req.user!.id) return res.status(404).json({ message: "File not found" });
      const filePath = getStoredUploadPath(file);
      if (!filePath) return res.status(404).json({ message: "File not found" });
      res.setHeader("Content-Type", file.fileType);
      res.download(filePath, file.filename, error => {
        if (error && !res.headersSent) res.status(404).json({ message: "File not found" });
      });
    } catch {
      if (!res.headersSent) res.status(404).json({ message: "File not found" });
    }
  });

  // Special development login endpoint
  if (DEVELOPMENT_MODE) {
    app.post("/api/dev-login", async (req, res) => {
      // Hard gate: never allow dev endpoints in production
      if (process.env.NODE_ENV === "production") {
        return res.status(404).json({ message: "Not found" });
      }
      try {
        // Try to get the development user
        const devUser = await storage.getUserByUsername("developer");
        
        if (!devUser) {
          return res.status(404).json({ message: "Development user not found" });
        }
        
        // Log the user in directly
        req.login(devUser, (err) => {
          if (err) return res.status(500).json({ message: "Login failed", error: err.message });
          const { password, ...safeUser } = devUser;
          return res.status(200).json({ ...safeUser, password: "***" });
        });
      } catch (error: any) {
        console.error("Dev login error:", error);
        res.status(500).json({ message: "Development login failed", error: error.message });
      }
    });
    
    console.log("Development login endpoint registered at /api/dev-login");
    
    // Quick setup endpoint for testing
    if (devConfig && devConfig.enabled) {
      app.post("/api/dev/quick-setup", async (req, res) => {
        // Hard gate: never allow dev endpoints in production
        if (process.env.NODE_ENV === "production") {
          return res.status(404).json({ message: "Not found" });
        }
        try {
          const userId = req.user?.id;
          if (!userId) {
            return res.status(401).json({ message: "Not authenticated" });
          }

          // Create conversation
          const conversation = await storage.createConversation({
            userId,
            title: "Quick Board Session"
          });

          // Add all experts from config — each with their assigned model
          const expertPromises = devConfig.experts.map((expert: any) =>
            storage.createExpert({
              conversationId: conversation.id,
              name: expert.name,
              role: expert.role,
              model: expert.model, // Use each expert's specific model from dev-config
              avatarUrl: expert.avatarUrl,
              systemPrompt: generateSystemPrompt({ role: expert.role } as any, undefined)
            })
          );

          await Promise.all(expertPromises);

          res.json({
            conversationId: conversation.id,
            expertCount: devConfig.experts.length
          });
        } catch (error: any) {
          console.error("Dev quick setup error:", error);
          res.status(500).json({ message: error.message });
        }
      });

      // Endpoint to update all experts in a conversation to use test model
      app.post("/api/dev/update-models/:conversationId", async (req, res) => {
        // Hard gate: never allow dev endpoints in production
        if (process.env.NODE_ENV === "production") {
          return res.status(404).json({ message: "Not found" });
        }
        try {
          const userId = req.user?.id;
          if (!userId) {
            return res.status(401).json({ message: "Not authenticated" });
          }

          const conversationId = parseInt(req.params.conversationId);
          const conversation = await storage.getConversation(conversationId);

          if (!conversation || conversation.userId !== userId) {
            return res.status(404).json({ message: "Conversation not found" });
          }

          const experts = await storage.getConversationExperts(conversationId);
          const testModel = devConfig.experts[0]?.model || "nvidia/nemotron-3-super-120b-a12b:free";

          // Update all experts to use the test model
          const updatePromises = experts.map((expert) =>
            storage.updateExpert(expert.id, { model: testModel })
          );

          await Promise.all(updatePromises);

          res.json({
            message: "All experts updated to use test model",
            expertCount: experts.length,
            model: testModel
          });
        } catch (error: any) {
          console.error("Dev update models error:", error);
          res.status(500).json({ message: error.message });
        }
      });
    }
  }
  
  const httpServer = createServer(app);
  
  // Initialize WebSocket server for real-time expert responses
  const wss = new WebSocketServer({ 
    server: httpServer,
    path: "/ws" // Specify a path for WebSocket connections
  });
  
  console.log("WebSocket server initialized on path: /ws");
  
  wss.on("connection", (ws, req) => {
    console.log("WebSocket client connected");

    ws.on("error", (error) => {
      console.error("WebSocket error:", error);
    });

    ws.on("close", () => {
      console.log("WebSocket client disconnected");
    });

    // G3: authenticate the upgrade against the same express-session store the
    // HTTP routes use. Without this, every connected socket receives every
    // conversation's streaming tokens.
    const rejectUnauthenticated = () => ws.close(4401, "Unauthenticated");
    const sid = getVerifiedSessionIdFromUpgradeRequest(req);

    if (!sid) {
      rejectUnauthenticated();
      return;
    }

    // Frames can arrive while the session-store lookup is still in flight —
    // with the pg store that lookup is a real round-trip, and a subscribe
    // sent immediately after the handshake would otherwise be dropped (no
    // message listener attached yet). Queue every early frame and drain it
    // in order once the socket is authenticated.
    const earlyFrames: RawData[] = [];
    let authenticatedMessageHandler: ((message: RawData) => void) | null = null;
    ws.on("message", (message) => {
      if (authenticatedMessageHandler) {
        authenticatedMessageHandler(message);
      } else {
        earlyFrames.push(message);
      }
    });

    storage.sessionStore.get(sid, (err: any, session: any) => {
      // The socket may have closed while the store lookup was in flight.
      if (ws.readyState !== 1) return;

      const userId = session?.passport?.user;
      if (err || userId == null) {
        rejectUnauthenticated();
        return;
      }

      (ws as any).userId = userId;
      (ws as any).subscriptions = new Set<number>();

      // Send an initial connection confirmation
      ws.send(JSON.stringify({
        type: "connection",
        data: { status: "connected" }
      }));

      const handleMessage = (message: RawData) => {
        try {
          let parsed: any;
          try {
            parsed = JSON.parse(message.toString());
          } catch {
            return; // Not JSON — ignore silently.
          }

          if (parsed?.type === "subscribe" && Number.isInteger(parsed.conversationId)) {
            const conversationId = parsed.conversationId;
            storage.getConversation(conversationId).then((conversation) => {
              if (conversation && conversation.userId === (ws as any).userId) {
                (ws as any).subscriptions.add(conversationId);
                ws.send(JSON.stringify({ type: "subscribed", conversationId }));
                // Replay the current orchestrator state so reconnects restore
                // the mode badge without a refetch.
                const state = getConversationState(conversationId);
                if (state) {
                  ws.send(JSON.stringify({
                    type: "state_update",
                    conversationId,
                    mode: state.mode,
                    isAutonomousEnabled: state.isAutonomousEnabled,
                    maxAutonomousTurns: state.maxAutonomousTurns,
                    ...(state.mode !== "idle" ? {
                      expertTurnsConsumed: state.totalAutonomousTurnsTaken,
                      expertTurnsRemaining: Math.max(0, state.maxAutonomousTurns - state.totalAutonomousTurnsTaken),
                    } : {})
                  }));
                } else {
                  // G7: no live in-memory state — the snapshot stored on the
                  // row (already loaded for the ownership check) is the only
                  // remaining truth. A processing_*/autonomous snapshot is a
                  // dead turn chain from before a restart: correct the badge
                  // to idle instead of letting the client assume nothing.
                  // Paused is real recoverable state: show the Paused badge —
                  // the next message's cold-start path restores it for real.
                  // Storage is intentionally not mutated here; the next
                  // message's cold-start path owns snapshot corrections.
                  // isAutonomousEnabled/maxAutonomousTurns are intentionally
                  // OMITTED: they are not part of the snapshot, and hardcoding
                  // a value here would flip the client's Enabled/Disabled
                  // badge on every reconnect (the client guards both fields
                  // with a typeof check and keeps its current value when
                  // they're absent). The real values arrive with the next
                  // live state_update.
                  const snapshot = conversation.orchestratorState;
                  if (snapshot && (snapshot.mode === "processing_sequential" || snapshot.mode === "autonomous")) {
                    ws.send(JSON.stringify({
                      type: "state_update",
                      conversationId,
                      mode: "idle"
                    }));
                  } else if (snapshot && snapshot.mode === "paused") {
                    ws.send(JSON.stringify({
                      type: "state_update",
                      conversationId,
                      mode: "paused"
                    }));
                  }
                }
              } else {
                ws.send(JSON.stringify({ type: "subscribe_denied", conversationId }));
              }
            }).catch((error) => {
              console.error("Error handling WebSocket subscribe:", error);
            });
          } else if (parsed?.type === "unsubscribe" && Number.isInteger(parsed.conversationId)) {
            (ws as any).subscriptions.delete(parsed.conversationId);
          }
          // Everything else is ignored silently.
        } catch (error) {
          console.error("Error processing WebSocket message:", error);
        }
      };

      authenticatedMessageHandler = handleMessage;
      // Drain any frames that arrived during the session lookup, in order.
      for (const frame of earlyFrames.splice(0)) {
        handleMessage(frame);
      }
    });
  });
  
  // Create a broadcast function. G3: send only to sockets that subscribed to
  // this conversation (ownership was verified at subscribe time).
  const broadcastToConversation = (conversationId: number, data: any) => {
    wss.clients.forEach((client) => {
      if (client.readyState === 1 && (client as any).subscriptions?.has(conversationId)) { // OPEN
        try {
          // Handle state_update messages (mode, autonomous status)
          if (data.type === "state_update") {
            client.send(JSON.stringify({
              type: "state_update",
              conversationId,
              mode: data.mode,
              isAutonomousEnabled: data.isAutonomousEnabled,
              maxAutonomousTurns: data.maxAutonomousTurns,
              expertTurnsConsumed: data.expertTurnsConsumed,
              expertTurnsRemaining: data.expertTurnsRemaining,
            }));
          }
          // Handle streaming events
          else if (data.type === "expert_stream_start") {
            client.send(JSON.stringify({
              type: "expert_stream_start",
              conversationId,
              expertId: data.expertId,
              expertName: data.expertName,
              expertRole: data.expertRole,
            }));
          }
          else if (data.type === "expert_stream_token") {
            client.send(JSON.stringify({
              type: "expert_stream_token",
              conversationId,
              expertId: data.expertId,
              token: data.token,
            }));
          }
          else if (data.type === "expert_stream_done") {
            client.send(JSON.stringify({
              type: "expert_stream_done",
              conversationId,
              expertId: data.expertId,
              message: data.message,
            }));
          }
          // Handle insights updates
          else if (data.type === "insights") {
            client.send(JSON.stringify({
              type: "insights",
              conversationId
            }));
          }
          // Steering remains reserved for explicit `/new` restarts.
          else if (data.type === "steering") {
            client.send(JSON.stringify({
              type: "steering",
              conversationId
            }));
          }
          // Busy farmer messages stay in the current flow; these events drive
          // the subtle queued indicator in the chat composer.
          else if (data.type === "message_queued" || data.type === "message_picked_up") {
            client.send(JSON.stringify({
              type: data.type,
              conversationId,
              messageId: data.messageId,
            }));
          }
          // The question panel refetches its conversation-scoped ledger when
          // an open question is created or answered.
          else if (data.type === "open_questions_updated") {
            client.send(JSON.stringify({
              type: "open_questions_updated",
              conversationId,
            }));
          }
          // Handle G5 conclusion: the Moderator ended the round; the closing
          // synthesis turn streams next.
          else if (data.type === "concluding") {
            client.send(JSON.stringify({
              type: "concluding",
              conversationId
            }));
          }
          // Handle G8 degradation notices: informational only (e.g. the
          // Moderator's routing call failed and the council falls back to
          // round-robin). Never blocks processing.
          else if (data.type === "notice") {
            client.send(JSON.stringify({
              type: "notice",
              conversationId,
              message: data.message
            }));
          }
          // Handle G9 next-speaker preview: who is about to speak, sent just
          // before their expert_stream_start.
          else if (data.type === "next_speaker") {
            client.send(JSON.stringify({
              type: "next_speaker",
              conversationId,
              expertId: data.expertId,
              expertRole: data.expertRole
            }));
          }
          // Handle error messages
          else if (data.type === "message_error") {
            // Prefer the persisted error message (survives refetch); fall back
            // to a synthetic frame when only error text is available.
            const persisted = data.message && typeof data.message === "object" && data.message.id
              ? data.message
              : null;
            client.send(JSON.stringify({
              type: "message_error",
              conversationId,
              expertId: data.expertId,
              expertName: data.expertName,
              message: persisted ?? {
                id: Date.now(),
                conversationId,
                content: `(Error generating response: ${data.message || 'Unknown error'})`,
                role: "assistant",
                expertId: data.expertId,
                expertName: data.expertName,
                expertRole: null,
                userId: null,
                timestamp: new Date()
              }
            }));
          }
          // Handle pipeline errors (message stays but processing must stop)
          else if (data.type === "error") {
            client.send(JSON.stringify({
              type: "error",
              conversationId,
              message: data.message || "Something went wrong."
            }));
          }
          // Handle regular messages (Message objects)
          else if (data.id && data.conversationId !== undefined && data.content) {
            client.send(JSON.stringify({
              type: "messages_updated",
              conversationId,
              message: data
            }));
          }
          // Fallback for unknown types
          else {
            console.warn("Unknown broadcast data type:", data);
          }
        } catch (error) {
          console.error("Error broadcasting message:", error);
        }
      }
    });
  };

  async function resolveAnswerQuestion(
    conversationId: number,
    requestedId: unknown,
  ): Promise<{ questionId: number | null } | { status: number; message: string }> {
    if (requestedId === undefined || requestedId === null) {
      const openQuestions = await storage.listOpenQuestions(conversationId);
      return { questionId: openQuestions.length === 1 ? openQuestions[0].id : null };
    }

    if (typeof requestedId !== "number" || !Number.isSafeInteger(requestedId) || requestedId <= 0) {
      return { status: 400, message: "answersQuestionId must be a positive integer." };
    }

    const question = await storage.getOpenQuestion(requestedId);
    if (!question || question.conversationId !== conversationId) {
      return { status: 404, message: "Open question not found." };
    }
    return { questionId: question.id };
  }

  async function assertMessageAllowance(userId: number, conversationId: number): Promise<void> {
    const user = await storage.getUser(userId);
    const credit = await creditForConversation(conversationId);
    if (credit) {
      // A session credit's 25-chair-brief cap belongs to this conversation.
      const usedInConversation = await storage.countConversationUserMessages(conversationId);
      const denial = checkMessageAllowance(user?.tier, 0, {
        kind: credit.kind as "fast" | "boardroom",
        usedMessages: usedInConversation,
      });
      if (denial) throw new UsageCapError(denial);
      return;
    }
    const usage = await storage.getMonthlyUsage(userId, currentUsagePeriod());
    const denial = checkMessageAllowance(user?.tier, usage.messageCount);
    if (denial) throw new UsageCapError(denial);
  }

  async function recordUserMessage(userId: number): Promise<void> {
    try {
      await storage.incrementMonthlyMessages(userId, currentUsagePeriod());
    } catch (err) {
      console.error("[CAPS] failed to record message usage:", (err as Error).message);
    }
  }

  function sendUsageCapError(res: Response, error: UsageCapError) {
    const { status, ...body } = error.denial;
    return res.status(status).json(body);
  }

  async function storeAndProcessUserMessage(
    userId: number,
    conversationId: number,
    content: string,
    answersQuestionId: number | null,
  ): Promise<{ message: Message; created: boolean }> {
    const startProcessing = (message: Message, questionId?: number) => {
      if (questionId !== undefined && answerTurnWasRecentlyDispatched(message.id)) return;
      if (questionId !== undefined) {
        rememberedAnswerTurnStarts.set(message.id, Date.now());
        if (rememberedAnswerTurnStarts.size > 1024) {
          const oldest = rememberedAnswerTurnStarts.keys().next().value;
          if (oldest !== undefined) rememberedAnswerTurnStarts.delete(oldest);
        }
      }
      const processing = processMessageTurnBased(userId, conversationId, message, broadcastToConversation);
      void processing.catch(error => {
        if (questionId !== undefined) rememberedAnswerTurnStarts.delete(message.id);
        console.error("Error during turn-based processing initiation:", error);
        broadcastToConversation(conversationId, {
          type: "error",
          message: "Failed to start expert processing.",
        });
      });
    };

    const existingMessages = await storage.getConversationMessages(conversationId);
    const answerAlreadyInFlightOrHandled = (message: Message): boolean => {
      if (answerTurnWasRecentlyDispatched(message.id)) return true;
      const currentState = getConversationState(conversationId);
      const liveSequence = currentState && ["processing_sequential", "autonomous", "paused"].includes(currentState.mode);
      if (liveSequence && (
        (currentState.lastUserMessage?.id ?? -1) >= message.id ||
        (currentState.pendingUserMessage?.id ?? -1) >= message.id
      )) return true;
      // G7 deliberately recovers dead turn chains to idle. If a real expert
      // response is already stored after this answer, do not replay a finished
      // (or already-partially-finished) discussion on an exact HTTP retry.
      return existingMessages.some(existing => existing.role === "assistant" && existing.id > message.id);
    };
    const lastExistingMessage = existingMessages[existingMessages.length - 1] ?? null;
    const priorLinkedAnswer = answersQuestionId === null
      ? undefined
      : [...existingMessages].reverse().find(message =>
          message.role === "user" && message.answersQuestionId === answersQuestionId,
        );
    const isExactLinkedAnswerRetry = priorLinkedAnswer !== undefined &&
      content.trim() === priorLinkedAnswer.content.trim();

    if (isExactLinkedAnswerRetry) {
      const questionBeforeRetry = await storage.getOpenQuestion(answersQuestionId!);
      if (!questionBeforeRetry) {
        throw new OpenQuestionAnswerConflictError("The selected open question is no longer available to answer.");
      }
      if (questionBeforeRetry.status === "answered" && questionBeforeRetry.answerMessageId !== priorLinkedAnswer!.id) {
        throw new OpenQuestionAnswerConflictError("The selected open question was answered by a different message.");
      }

      if (questionBeforeRetry.status === "open") {
        const answerClaim = await storage.claimOpenQuestionAnswer(answersQuestionId!, priorLinkedAnswer!.id);
        if (!answerClaim) {
          throw new OpenQuestionAnswerConflictError("The selected open question is no longer available to answer.");
        }
        if (answerClaim.claimed) {
          broadcastToConversation(conversationId, priorLinkedAnswer!);
          broadcastToConversation(conversationId, { type: "open_questions_updated" });
          if (!answerAlreadyInFlightOrHandled(priorLinkedAnswer!)) {
            startProcessing(priorLinkedAnswer!, answersQuestionId!);
          }
        }
      } else if (!answerAlreadyInFlightOrHandled(priorLinkedAnswer!)) {
        // Covers a commit whose acknowledgement failed before its route
        // could dispatch G11. A retry starts it if no live or completed turn
        // is visible; completed/dead chains follow the G7 recovery rules.
        startProcessing(priorLinkedAnswer!, answersQuestionId!);
      }
      return { message: priorLinkedAnswer!, created: false };
    }

    if (answersQuestionId === null && isDuplicateUserSubmission(content, lastExistingMessage, false)) {
      console.log(`Duplicate user submission detected in conversation ${conversationId} — skipping processing.`);
      return { message: lastExistingMessage!, created: false };
    }

    // Pricing caps: a "message" = one Chair message (see server/usage-caps.ts).
    // A conversation on a one-time credit counts against that credit's cap.
    await assertMessageAllowance(userId, conversationId);

    const conversationExperts = await storage.getConversationExperts(conversationId);
    const userMessage: InsertMessage = {
      conversationId,
      userId,
      expertId: null,
      content,
      role: "user",
      mentions: extractMentions(content, conversationExperts.map(expert => expert.role), conversationExperts),
      answersQuestionId,
    };
    let storedMessage: Message;
    if (answersQuestionId !== null) {
      const result = await storage.createAnswerMessage(userMessage, answersQuestionId);
      if (!result) {
        throw new OpenQuestionAnswerConflictError("The selected open question is no longer available to answer.");
      }
      storedMessage = result.message;
    } else {
      storedMessage = await storage.createMessage(userMessage);
    }
    await recordUserMessage(userId);

    // Broadcast the saved answer itself for transcript compatibility, then
    // signal subscribers to refresh the question list after its status change.
    broadcastToConversation(conversationId, storedMessage);
    if (answersQuestionId !== null) {
      broadcastToConversation(conversationId, { type: "open_questions_updated" });
    }

    if (isRetrievalOnlyRequest(content)) {
      const currentDeliverables = await storage.getCurrentDeliverableFiles(conversationId);
      const legacyGeneratedFiles = (await storage.getConversationFiles(conversationId))
        .filter(file => file.uploadedBy.toLowerCase() !== "user" && !file.deliverableId)
        .sort((a, b) => (b.uploadedAt?.getTime() ?? 0) - (a.uploadedAt?.getTime() ?? 0));
      const candidates = [...currentDeliverables, ...legacyGeneratedFiles];
      const experts = await storage.getConversationExperts(conversationId);
      const moderator = experts.find(expert => expert.role.trim().toLowerCase() === "moderator");
      const retrievalReply = await storage.createMessage({
        conversationId,
        userId: null,
        expertId: moderator?.id ?? null,
        content: buildStoredDeliverableReply(content, candidates),
        role: "assistant",
        expertName: moderator?.name ?? "Moderator",
        expertRole: moderator?.role ?? "Moderator",
      });
      broadcastToConversation(conversationId, retrievalReply);

      // If a council chain is already active, let the orchestrator record this
      // latest farmer instruction so queued File Creator work is suppressed.
      // Idle retrievals are answered from storage without any provider call.
      const state = getConversationState(conversationId);
      if (state && ["processing_sequential", "autonomous", "paused"].includes(state.mode)) {
        startProcessing(storedMessage, answersQuestionId ?? undefined);
      }
    } else {
      startProcessing(storedMessage, answersQuestionId ?? undefined);
    }

    return { message: storedMessage, created: true };
  }

  // Check Subscription Status
  app.get("/api/subscription-status", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ subscribed: false, message: "Not authenticated" });
    }
    
    const user = req.user;
    return res.json({ 
      subscribed: user.subscriptionStatus === "active",
      status: user.subscriptionStatus
    });
  });
  
  // Stripe Checkout: Pro / Boardroom subscriptions and $5 / $15 one-time
  // session credits. The client sends a plan/interval or a session kind —
  // never a price id. Missing ids fail closed for that option only.
  app.post("/api/create-checkout-session", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (!stripe) {
      { const r = billingUnavailable("Stripe integration not configured"); return res.status(r.status).json(r.body); }
    }
    const parsed = parseCheckoutRequest(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ code: "INVALID_CHECKOUT_REQUEST", message: parsed.message });
    }
    const request = parsed.value;
    try {
      const user = req.user;
      const origin = resolveReturnOrigin(req.headers.origin);
      const { successUrl, cancelUrl } = checkoutUrls(origin, "success");

      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          name: user.username,
        });
        customerId = customer.id;
        await storage.updateUserStripeInfo(user.id, {
          stripeCustomerId: customerId,
          stripeSubscriptionId: user.stripeSubscriptionId || "",
        });
      }

      if (request.mode === "payment") {
        const { envName, priceId } = resolveSessionPriceId(request.sessionKind);
        if (!priceId) {
          { const r = billingUnavailable(`${envName} is not configured`); return res.status(r.status).json(r.body); }
        }
        const session = await stripe.checkout.sessions.create({
          customer: customerId,
          mode: "payment",
          line_items: [{ price: priceId, quantity: 1 }],
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            userId: String(user.id),
            sessionKind: request.sessionKind,
          },
        });
        return res.json({ url: session.url, mode: "payment", sessionKind: request.sessionKind });
      }

      const { plan, interval } = request;
      const { envName, priceId } = resolveSubscriptionPriceId(plan, interval);
      if (!priceId) {
        { const r = billingUnavailable(`${envName} is not configured`); return res.status(r.status).json(r.body); }
      }

      // Plan change: an active subscriber switching plans (Pro → Boardroom,
      // or the reverse) updates the existing subscription in place. This is
      // simpler and more correct than a second checkout, which would leave
      // two live subscriptions: Stripe prorates the difference and the
      // subscription.updated webhook moves the tier.
      const hasLiveSubscription = Boolean(user.stripeSubscriptionId) &&
        ["active", "trialing", "past_due"].includes(user.subscriptionStatus ?? "");
      if (hasLiveSubscription && user.stripeSubscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
        const currentItem = (subscription.items?.data ?? [])[0];
        const currentPriceId = currentItem?.price?.id;
        if (currentPriceId === priceId) {
          // Already on this exact plan and interval: never create a duplicate
          // subscription on a repeat click.
          return res.json({ updated: true, unchanged: true, plan, interval });
        }
        if (currentPriceId !== priceId) {
          await stripe.subscriptions.update(user.stripeSubscriptionId, {
            items: currentItem
              ? [{ id: currentItem.id, price: priceId }]
              : [{ price: priceId }],
            proration_behavior: "create_prorations",
            metadata: { userId: String(user.id), plan },
          });
          await storage.updateUserTier(user.id, plan);
          return res.json({ updated: true, plan, interval });
        }
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          userId: String(user.id),
          plan,
          interval,
        },
        subscription_data: {
          metadata: {
            userId: String(user.id),
            plan,
          },
        },
      });

      res.json({ url: session.url, mode: "subscription", plan, interval });
    } catch (error: any) {
      console.error("Stripe checkout error:", error);
      { const r = billingErrorResponse(error, "create-checkout-session"); res.status(r.status).json(r.body); }
    }
  });

  // Stripe Customer Portal — cards, invoices, cancellation.
  app.post("/api/billing-portal", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (!stripe) {
      { const r = billingUnavailable("Stripe integration not configured"); return res.status(r.status).json(r.body); }
    }
    const user = req.user;
    if (!user.stripeCustomerId) {
      return res.status(400).json({ code: "NO_BILLING_ACCOUNT", message: "No billing account yet. Choose a plan first." });
    }
    try {
      const portal = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${resolveReturnOrigin(req.headers.origin)}/subscribe`,
      });
      res.json({ url: portal.url });
    } catch (error: any) {
      { const r = billingErrorResponse(error, "billing-portal"); res.status(r.status).json(r.body); }
    }
  });

  // Cancel subscription
  app.post("/api/cancel-subscription", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (!stripe) {
      { const r = billingUnavailable("Stripe integration not configured"); return res.status(r.status).json(r.body); }
    }
    try {
      const user = req.user;
      if (!user.stripeSubscriptionId) {
        return res.status(400).json({ message: "No active subscription" });
      }
      await stripe.subscriptions.cancel(user.stripeSubscriptionId);
      // Pricing v1: cancellation must actually downgrade the plan, not just
      // flip subscriptionStatus (the old code left the user on Pro forever).
      const updated = await storage.updateUserPlan(user.id, { tier: "free", status: "canceled" });
      res.json({ message: "Subscription cancelled", tier: updated.tier ?? "free" });
    } catch (error: any) {
      console.error("Stripe cancel error:", error);
      { const r = billingErrorResponse(error, "cancel-subscription"); res.status(r.status).json(r.body); }
    }
  });

  // Stripe subscription endpoints (legacy/retired — UI uses /api/create-checkout-session)
  app.post("/api/create-subscription", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Authentication required" });
    }
    
    if (!stripe) {
      { const r = billingUnavailable("Stripe integration not configured"); return res.status(r.status).json(r.body); }
    }
    
    try {
      const user = req.user;

      // If the user already has a subscription on record, retrieve it instead
      // of creating a duplicate (payment may still be incomplete — that's ok,
      // the client uses the clientSecret to finish checkout).
      if (user.stripeSubscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
        return res.json({
          subscriptionId: subscription.id,
          clientSecret: getSubscriptionClientSecret(subscription),
        });
      }
      
      // Create or get Stripe customer
      let customerId = user.stripeCustomerId;
      
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          name: user.username,
        });
        customerId = customer.id;
      }
      
      // Create subscription
      // Retired: the UI now uses /api/create-checkout-session. Kept only for
      // old clients; uses the same Pro price. STRIPE_PRICE_ID is a deprecated fallback.
      const PRICE_ID = process.env.STRIPE_PRICE_ID_PRO || process.env.STRIPE_PRICE_ID;
      if (!PRICE_ID) {
        { const r = billingUnavailable("Stripe price ID not configured"); return res.status(r.status).json(r.body); }
      }
      
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: PRICE_ID }],
        payment_behavior: "default_incomplete",
        payment_settings: { save_default_payment_method: "on_subscription" },
        expand: ["latest_invoice.payment_intent"],
      });
      
      // Update user with Stripe info
      await storage.updateUserStripeInfo(user.id, {
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscription.id
      });
      
      res.json({
        subscriptionId: subscription.id,
        clientSecret: getSubscriptionClientSecret(subscription),
      });
    } catch (error: any) {
      console.error("Stripe error:", error);
      { const r = billingErrorResponse(error, "create-subscription"); res.status(r.status).json(r.body); }
    }
  });
  
  // Stripe webhook handler. Pricing v1 events:
  // - checkout.session.completed → subscription tier or one session credit
  // - customer.subscription.updated → price id maps to a tier; past_due and
  //   cancel transitions are reflected, never guessed
  // - customer.subscription.deleted → downgrade to free
  // - invoice.payment_succeeded / invoice.payment_failed → status only
  app.post("/api/webhook", async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    if (!stripe || !endpointSecret || !sig) {
      return res.status(400).json({ message: "Missing Stripe configuration" });
    }
    
    let event;

    try {
      // Signature verification requires the exact raw bytes Stripe sent.
      event = stripe.webhooks.constructEvent(
        (req as any).rawBody ?? req.body,
        sig,
        endpointSecret
      );
    } catch (err: any) {
      console.error(`Webhook Error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    
    // A delivery without an object payload cannot be processed; acknowledge it
    // (a retry would send the same malformed body). Real handler failures below
    // answer 500 so Stripe retries.
    if (!event.data?.object) {
      console.warn(`[BILLING] webhook ${event.type} has no data object; ignoring`);
      return res.json({ received: true });
    }

    try {
      switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded": {
          const session = event.data.object as any;
          const userId = Number(session.metadata?.userId ?? session.client_reference_id);
          const user = Number.isSafeInteger(userId) && userId > 0
            ? await storage.getUser(userId)
            : null;

          // Never grant a plan or a credit before the money lands. Delayed
          // payment methods complete the session as "unpaid"; the later
          // checkout.session.async_payment_succeeded event is the grant.
          // A subscription trial legitimately reports no_payment_required.
          const paymentStatus = session.payment_status;
          const paid = paymentStatus === "paid"
            || (session.mode === "subscription" && paymentStatus === "no_payment_required");
          if (!paid) {
            console.log(`[BILLING] checkout ${session.id} ${event.type} with payment_status=${paymentStatus}; not granting yet`);
            break;
          }

          if (session.mode === "payment") {
            const kind = session.metadata?.sessionKind;
            if (!user) {
              console.error(`[BILLING] checkout.session.completed payment has no resolvable user (metadata.userId=${session.metadata?.userId ?? "-"})`);
              break;
            }
            if (!isSessionKind(kind)) {
              console.error(`[BILLING] checkout.session.completed payment has an unknown sessionKind`);
              break;
            }
            // Idempotent on the Stripe checkout session id: replays are no-ops.
            const { created } = await storage.grantSessionCredit({
              userId: user.id,
              kind,
              stripeCheckoutSessionId: session.id,
            });
            console.log(`[BILLING] session credit ${created ? "granted" : "already present"} for user ${user.id} (${kind})`);
            break;
          }

          const subscriptionId = typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
          const plan = session.metadata?.plan === "boardroom" ? "boardroom" : "pro";
          const targetUser = user ?? (typeof session.customer === "string"
            ? await storage.getUserByStripeCustomerId(session.customer)
            : undefined);
          if (!targetUser) {
            console.error(`[BILLING] checkout.session.completed subscription has no resolvable user`);
            break;
          }
          await storage.updateUserStripeInfo(targetUser.id, {
            stripeCustomerId: typeof session.customer === "string" ? session.customer : targetUser.stripeCustomerId ?? "",
            stripeSubscriptionId: subscriptionId ?? targetUser.stripeSubscriptionId ?? "",
          });
          await storage.updateUserPlan(targetUser.id, { tier: plan, status: "active" });
          console.log(`[BILLING] user ${targetUser.id} upgraded to ${plan}`);
          break;
        }

        case "invoice.payment_succeeded": {
          const invoice = event.data.object as any; // Type assertion to avoid TS errors
          if (invoice.subscription) {
            // Look the user up by their stored subscription id — scanning ids
            // 0-99 breaks activation once the app has more than 100 users.
            const user = await storage.getUserByStripeSubscriptionId(invoice.subscription);
            if (user) {
              // Map the billed price back to a plan when the invoice carries
              // one (covers subscriptions created outside Checkout).
              const priceId = invoice.lines?.data?.[0]?.price?.id
                ?? invoice.lines?.data?.[0]?.plan?.id;
              const plan = tierForSubscriptionPriceId(priceId);
              await storage.updateUserPlan(user.id, {
                status: "active",
                ...(plan ? { tier: plan } : {}),
              });
              console.log(`Updated user ${user.id} subscription to active${plan ? ` (${plan})` : ""}`);
            }
          }
          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object as any;
          if (invoice.subscription) {
            const user = await storage.getUserByStripeSubscriptionId(invoice.subscription);
            if (user) {
              await storage.updateSubscriptionStatus(user.id, "past_due");
              console.log(`User ${user.id} subscription is past_due`);
            }
          }
          break;
        }

        case "customer.subscription.deleted": {
          const subscription = event.data.object as any;
          const user = await storage.getUserByStripeSubscriptionId(subscription.id)
            ?? (typeof subscription.customer === "string"
              ? await storage.getUserByStripeCustomerId(subscription.customer)
              : undefined);
          if (user) {
            // A deleted subscription is a real downgrade: plan back to free.
            await storage.updateUserPlan(user.id, { tier: "free", status: "canceled" });
            console.log(`User ${user.id} subscription deleted — downgraded to free`);
          }
          break;
        }

        case "customer.subscription.updated": {
          const subscription = event.data.object as any; // Type assertion to avoid TS errors
          const user = await storage.getUserByStripeSubscriptionId(subscription.id)
            ?? (typeof subscription.customer === "string"
              ? await storage.getUserByStripeCustomerId(subscription.customer)
              : undefined);
          if (user) {
            const priceId = subscription.items?.data?.[0]?.price?.id
              ?? subscription.items?.data?.[0]?.plan?.id;
            const planFromPrice = tierForSubscriptionPriceId(priceId);
            const status: string = subscription.status;
            if (status === "canceled" || status === "unpaid" || status === "incomplete_expired") {
              await storage.updateUserPlan(user.id, { tier: "free", status });
              console.log(`User ${user.id} subscription ${status} — downgraded to free`);
            } else if (status === "past_due") {
              // Grace: keep the plan while Stripe retries the card.
              await storage.updateSubscriptionStatus(user.id, "past_due");
              console.log(`User ${user.id} subscription past_due`);
            } else if (status === "active" || status === "trialing") {
              const plan = planFromPrice ?? (user.tier === "boardroom" ? "boardroom" : "pro");
              await storage.updateUserPlan(user.id, { tier: plan, status: "active" });
              console.log(`User ${user.id} subscription ${status} on ${plan}`);
            } else {
              await storage.updateSubscriptionStatus(user.id, status);
              console.log(`User ${user.id} subscription status ${status}`);
            }
          }
          break;
        }
      }
    } catch (error) {
      // A handler failure must reach Stripe as non-2xx so it retries. Every
      // grant is idempotent (checkout session id / plan write), so a retry
      // cannot double-grant a credit or a tier.
      console.error(`[BILLING] webhook ${event.type} failed:`, error);
      return res.status(500).json({ error: "Webhook processing failed" });
    }

    res.json({ received: true });
  });
  
  // Get user tier and limits
  app.get("/api/user/tier", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Authentication required" });
    }
    try {
      const user = await storage.getUser(req.user!.id);
      const tier = user?.tier || "free";
      const limits = getTierLimits(tier);
      const usage = await storage.getMonthlyUsage(req.user!.id, currentUsagePeriod());
      const credits = await storage.listSessionCredits(req.user!.id);
      const availableCredits = credits.filter(credit => credit.status === "available");
      res.json({
        tier,
        planName: PLAN_PRICING[tier as keyof typeof PLAN_PRICING]?.name ?? limits.name,
        limits,
        usage: { period: currentUsagePeriod(), messages: usage.messageCount, aiSpendUsd: usage.aiSpendUsd },
        // True once house-key paid calls are on the paid overage fallback.
        aiBudgetExhausted: (tier === "pro" || tier === "boardroom") && !user?.openRouterKey && usage.aiSpendUsd >= monthlyAiBudgetUsd(tier),
        aiBudgetNotice: BUDGET_EXHAUSTED_NOTICE,
        aiBudgetUsd: Number.isFinite(monthlyAiBudgetUsd(tier)) ? monthlyAiBudgetUsd(tier) : null,
        // Paid models usable on the house key for this plan; any model works
        // with BYOK. Frontier slugs are Boardroom-only.
        houseKeyModels: houseKeyModelsForTier(tier),
        frontierModels: [...BOARDROOM_FRONTIER_MODEL_ALLOWLIST],
        frontierModelLabels: FRONTIER_MODEL_LABELS,
        // One-time session credits: `available` is spendable now.
        sessionCredits: {
          available: availableCredits.length,
          fast: availableCredits.filter(credit => credit.kind === "fast").length,
          boardroom: availableCredits.filter(credit => credit.kind === "boardroom").length,
          used: credits.filter(credit => credit.status === "used").length,
        },
        // Display prices (never Stripe ids).
        pricing: {
          proMonthlyUsd: PLAN_PRICING.pro.monthlyUsd,
          proAnnualUsd: PLAN_PRICING.pro.annualUsd,
          boardroomMonthlyUsd: PLAN_PRICING.boardroom.monthlyUsd,
          boardroomAnnualUsd: PLAN_PRICING.boardroom.annualUsd,
          sessionFastUsd: SESSION_PRICING.fast.priceUsd,
          sessionBoardroomUsd: SESSION_PRICING.boardroom.priceUsd,
        },
        hasOwnKey: Boolean(user?.openRouterKey),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  app.post("/api/protected/conversations", async (req, res) => {
    let consumedCredit: SessionCredit | undefined;
    try {
      const userId = req.user!.id;
      const title = req.body.title || "New board session";
      const user = await storage.getUser(userId);
      const tier = user?.tier || "free";
      // A one-time credit is spent ONLY when the Chair explicitly picks a
      // session board. A Free user holding a credit who starts an ordinary
      // board keeps the credit for later.
      const requestedKind = req.body?.sessionCreditKind;
      if (requestedKind !== undefined && !isSessionKind(requestedKind)) {
        return res.status(400).json({ code: "INVALID_SESSION_CREDIT_KIND", message: "Choose a fast or boardroom session." });
      }

      // Pricing v1: a Free account that chooses a $5/$15 session board starts
      // this conversation on that credit. The credit is consumed here (the
      // conversation's creation), and its limits apply for the conversation's
      // whole life. consumeSessionCredit is atomic, so two tabs cannot spend
      // the same credit twice.
      if (tier === "free" && isSessionKind(requestedKind)) {
        const available = (await storage.listSessionCredits(userId))
          .filter(credit => credit.status === "available" && credit.kind === requestedKind)
          .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
        for (const candidate of available) {
          consumedCredit = await storage.consumeSessionCredit(candidate.id, userId);
          if (consumedCredit) break;
        }
        if (!consumedCredit) {
          return res.status(409).json({
            code: "SESSION_CREDIT_UNAVAILABLE",
            message: `No ${requestedKind === "boardroom" ? "Boardroom Session" : "Single Session"} credit is available. Buy one or start a Free board.`,
          });
        }
      }

      const conversation: InsertConversation = {
        userId,
        title,
        ...(consumedCredit ? { sessionCreditId: consumedCredit.id } : {}),
      };

      const createdConversation = await storage.createConversation(conversation);
      if (consumedCredit) {
        await storage.attachSessionCreditToConversation(consumedCredit.id, createdConversation.id);
      }
      // sessionCreditKind lets the client size the board to the credit's cap
      // (5 vs 8 seats) instead of the Free plan's 3.
      res.status(201).json({
        ...createdConversation,
        sessionCreditKind: consumedCredit?.kind ?? null,
      });
    } catch (error: any) {
      // Never burn a credit if the conversation could not be created.
      if (consumedCredit) await storage.releaseSessionCredit(consumedCredit.id).catch(() => {});
      res.status(500).json({ message: error.message });
    }
  });
  
  app.get("/api/protected/conversations", async (req, res) => {
    try {
      const userId = req.user!.id;
      const conversations = await storage.getUserConversations(userId);
      // Decorate with the one-time credit kind so the client can size the
      // board correctly (5 vs 8 seats) without an extra round trip.
      const credits = await storage.listSessionCredits(userId);
      const kindByConversation = new Map(
        credits.filter(credit => credit.conversationId !== null).map(credit => [credit.conversationId as number, credit.kind]),
      );
      res.json(conversations.map(conversation => ({
        ...conversation,
        sessionCreditKind: kindByConversation.get(conversation.id) ?? null,
      })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  app.get("/api/protected/conversations/:id", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getConversation(conversationId);

      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      const credit = await creditForConversation(conversationId);
      res.json({ ...conversation, sessionCreditKind: credit?.kind ?? null });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update a conversation's title, council charter, and/or turn budget
  // (G6/G13). Ownership is
  // enforced exactly like the sibling protected conversation routes (a
  // mismatched or missing conversation is a 404 — no existence leak).
  app.put("/api/protected/conversations/:id", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getConversation(conversationId);

      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      const parsed = updateConversationSchema.strict().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid conversation update", errors: parsed.error.flatten() });
      }
      if (Object.keys(parsed.data).length === 0) {
        return res.status(400).json({ message: "Nothing to update: provide a title, charter, or turn budget" });
      }

      const updates = parsed.data.turnBudget === 0
        ? { ...parsed.data, turnBudget: null }
        : parsed.data;
      const updatedConversation = await storage.updateConversation(conversationId, updates);
      if (!updatedConversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      if (updates.turnBudget !== undefined) {
        await persistAutonomySettings(conversationId, { maxAutonomousTurns: updates.turnBudget });
      }

      res.json(updatedConversation);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Delete a conversation and everything in it. Refused while a discussion
  // is running; same 404-on-mismatch ownership rule as the sibling routes.
  app.delete("/api/protected/conversations/:id", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getConversation(conversationId);

      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      if (isConversationBusy(conversationId)) {
        return res.status(409).json({ message: "Wait for the discussion to finish before deleting this conversation." });
      }

      const conversationFiles = await storage.getConversationFiles(conversationId);
      await discardConversationState(conversationId);
      await storage.deleteConversation(conversationId);
      // Best-effort: the rows are gone, so a leftover file must not fail the request.
      for (const file of conversationFiles) {
        const filePath = getStoredUploadPath(file);
        if (filePath) await fs.promises.unlink(filePath).catch(() => {});
      }
      res.status(204).end();
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Expert endpoints
  app.post("/api/protected/conversations/:id/experts", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getConversation(conversationId);
      
      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      const user = await storage.getUser(req.user!.id);
      const tier = user?.tier || "free";
      // A conversation running on a one-time session credit uses that
      // credit's seat cap, not the plan's.
      const limits = await effectiveLimits(tier, conversationId);

      // Check expert count limit
      const existingExperts = await storage.getConversationExperts(conversationId);
      if (existingExperts.length >= limits.maxExperts) {
        return res.status(403).json({
          code: "TIER_LIMIT_EXPERTS",
          limit: limits.maxExperts,
          message: `${limits.name} allows up to ${limits.maxExperts} experts in this session.`,
        });
      }
      
      const { name, model } = req.body;
      if (typeof model !== "string" || !model.trim()) {
        return res.status(400).json({ message: "Choose a model for this seat." });
      }
      // Paid plans and session credits always seat a paid expert model. A
      // ':free' request (stale client, bundled catalog default) is rewritten
      // to the tier's paid default before the allowlist gate runs.
      const resolvedModel = resolveExpertModelForContext(model, {
        paid: Boolean(limits.credit) || tier !== "free",
        allowFrontier: Boolean(limits.allowFrontierModels),
      });
      const role = typeof req.body.role === "string" ? req.body.role.trim().slice(0, 60) : "";
      if (!role || /^(user|chair|farmer)$/i.test(role)) {
        return res.status(400).json({ message: "Choose a valid expert role." });
      }
      if (existingExperts.some(e => e.role.toLowerCase() === role.toLowerCase())) {
        return res.status(409).json({ message: `A ${role} is already at the table.` });
      }
      const customInstructions = typeof req.body.customInstructions === "string" && req.body.customInstructions.trim()
        ? req.body.customInstructions.trim().slice(0, 2000)
        : null;
      // Built-in roles always get the bundled avatar; custom roles get the custom badge.
      const avatarUrl = catalogAvatar(role);

      // House-key model gate: paid models need Pro/Boardroom (or a session
      // credit); frontier slugs are Boardroom-only. BYOK may pick anything
      // except a free model on a paid board (handled above).
      const modelDenial = await houseKeyModelDenial(req.user!.id, tier, resolvedModel, conversationId);
      if (modelDenial) {
        return res.status(modelDenial.status).json({
          code: modelDenial.code,
          message: modelDenial.message,
          ...(modelDenial.upgradeUrl ? { upgradeUrl: modelDenial.upgradeUrl } : {}),
        });
      }
      
      const expert: InsertExpert = {
        conversationId,
        name,
        role,
        model: resolvedModel,
        systemPrompt: generateSystemPrompt({ role, customInstructions } as any),
        avatarUrl,
        customInstructions,
      };
      
      const createdExpert = await storage.createExpert(expert);
      res.status(201).json(createdExpert);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  app.get("/api/protected/conversations/:id/experts", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getConversation(conversationId);

      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      const experts = await storage.getConversationExperts(conversationId);
      res.json(experts);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Remove an expert from a conversation. Refused while a discussion is
  // running, since the turn loop holds the roster in memory.
  app.delete("/api/protected/conversations/:conversationId/experts/:expertId", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.conversationId);
      const expertId = parseInt(req.params.expertId);
      const conversation = await storage.getConversation(conversationId);

      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      const expert = await storage.getExpertById(expertId);
      if (!expert || expert.conversationId !== conversationId) {
        return res.status(404).json({ message: "Expert not found" });
      }
      if (isConversationBusy(conversationId)) {
        return res.status(409).json({ message: "Wait for the discussion to finish before removing an expert." });
      }

      await storage.deleteExpert(expertId);
      // Idle state caches the roster; drop it so the next message rebuilds it.
      await discardConversationState(conversationId);
      // A persisted paused snapshot indexes the old roster; clear it so
      // resume cannot restore a stale expert index.
      await storage.updateConversation(conversationId, { orchestratorState: null });
      res.status(204).end();
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Update expert settings
  app.patch("/api/experts/:expertId", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Authentication required" });
      }
      const expertId = parseInt(req.params.expertId);
      const expert = await storage.getExpertById(expertId);

      if (!expert) {
        return res.status(404).json({ message: "Expert not found" });
      }

      // Verify user owns this conversation
      const conversation = await storage.getConversation(expert.conversationId);
      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(403).json({ message: "Not authorized to update this expert" });
      }

      const { name, model, customInstructions } = req.body;
      const updates: Partial<any> = {};

      if (name !== undefined) updates.name = name;
      if (customInstructions !== undefined) updates.customInstructions = customInstructions;

      // Enforce the same model gate as expert creation — without this,
      // free-tier users could upgrade any expert's model via the settings
      // modal and bypass the gate entirely. A paid board also rewrites any
      // ':free' model to its paid default here.
      if (model !== undefined) {
        if (typeof model !== "string" || !model.trim()) {
          return res.status(400).json({ message: "Choose a model for this seat." });
        }
        const user = await storage.getUser(req.user!.id);
        const tier = user?.tier || "free";
        const limits = await effectiveLimits(tier, expert.conversationId);
        const resolvedModel = resolveExpertModelForContext(model, {
          paid: Boolean(limits.credit) || tier !== "free",
          allowFrontier: Boolean(limits.allowFrontierModels),
        });
        updates.model = resolvedModel;
        const modelDenial = await houseKeyModelDenial(req.user!.id, tier, resolvedModel, expert.conversationId);
        if (modelDenial) {
          return res.status(modelDenial.status).json({
            code: modelDenial.code,
            message: modelDenial.message,
            ...(modelDenial.upgradeUrl ? { upgradeUrl: modelDenial.upgradeUrl } : {}),
          });
        }
      }

      const updatedExpert = await storage.updateExpert(expertId, updates);
      res.json(updatedExpert);
    } catch (error: any) {
      console.error("Error updating expert:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Company profile endpoints
  app.get("/api/protected/company-profile", async (req, res) => {
    try {
      const userId = req.user!.id;
      const profile = await storage.getCompanyProfile(userId);
      res.json({ profile: profile || null });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/protected/company-profile", async (req, res) => {
    try {
      const userId = req.user!.id;
      // Validate and whitelist — req.body must never be spread straight into
      // storage or clients could inject id/createdAt/arbitrary columns.
      const parsed = insertCompanyProfileSchema.omit({ userId: true }).partial().strict().safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid company profile data", errors: parsed.error.flatten() });
      }
      const profile = await storage.upsertCompanyProfile(userId, parsed.data);
      res.json(profile);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // Message endpoints
  app.get("/api/protected/conversations/:id/open-questions", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getConversation(conversationId);
      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      const questions = await storage.listOpenQuestions(conversationId);
      return res.json(questions);
    } catch (error: any) {
      return res.status(500).json({ message: error.message || "Internal server error" });
    }
  });

  app.post("/api/protected/conversations/:id/messages", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getConversation(conversationId);
      
      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      
      const userId = req.user!.id;
      const { content, answersQuestionId } = req.body ?? {};
      const resolution = await resolveAnswerQuestion(conversationId, answersQuestionId);
      if ("status" in resolution) {
        return res.status(resolution.status).json({ message: resolution.message });
      }

      // An explicit answer to a different question is a different submission
      // even if its prose repeats the previous message. Ordinary duplicate
      // messages retain the existing F2 duplicate gate.
      const result = await storeAndProcessUserMessage(
        userId,
        conversationId,
        content,
        resolution.questionId,
      );

      return res.status(result.created ? 201 : 200).json(result.message);
    } catch (error: any) {
      console.error("Error in POST /messages:", error);
      if (error instanceof UsageCapError) return sendUsageCapError(res, error);
      if (error instanceof OpenQuestionAnswerConflictError) {
        return res.status(409).json({ message: error.message });
      }
      return res.status(500).json({ message: error.message || "Internal server error" });
    }
  });

  app.post("/api/protected/conversations/:id/open-questions/:questionId/answer", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getConversation(conversationId);
      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      const questionId = Number(req.params.questionId);
      if (!Number.isSafeInteger(questionId) || questionId <= 0) {
        return res.status(400).json({ message: "Invalid question id." });
      }
      const { content } = req.body ?? {};
      if (typeof content !== "string" || content.trim().length === 0) {
        return res.status(400).json({ message: "An answer is required." });
      }

      const resolution = await resolveAnswerQuestion(conversationId, questionId);
      if ("status" in resolution) {
        return res.status(resolution.status).json({ message: resolution.message });
      }

      const result = await storeAndProcessUserMessage(
        req.user!.id,
        conversationId,
        content,
        resolution.questionId,
      );
      return res.status(result.created ? 201 : 200).json(result.message);
    } catch (error: any) {
      console.error("Error answering an open question:", error);
      if (error instanceof UsageCapError) return sendUsageCapError(res, error);
      if (error instanceof OpenQuestionAnswerConflictError) {
        return res.status(409).json({ message: error.message });
      }
      return res.status(500).json({ message: error.message || "Internal server error" });
    }
  });

  // Explicit topic restart. Ordinary messages join the active council flow;
  // only this endpoint retains the interrupt-and-restart behavior.
  app.post("/api/protected/conversations/:id/restart", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getConversation(conversationId);
      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      const requestedTopic = typeof req.body?.topic === "string"
        ? req.body.topic.trim()
        : typeof req.body?.content === "string"
          ? req.body.content.trim()
          : "";
      const history = await storage.getConversationMessages(conversationId);
      const previousUserMessage = [...history].reverse().find(message => message.role === "user") ?? null;
      if (!requestedTopic && !previousUserMessage) {
        return res.status(400).json({ message: "A topic is required to start a discussion." });
      }

      let restartMessage: Message;
      if (requestedTopic) {
        await assertMessageAllowance(req.user!.id, conversationId);
        const conversationExperts = await storage.getConversationExperts(conversationId);
        restartMessage = await storage.createMessage({
          conversationId,
          userId: req.user!.id,
          expertId: null,
          content: requestedTopic,
          role: "user",
          mentions: extractMentions(requestedTopic, conversationExperts.map(expert => expert.role)),
        });
        await recordUserMessage(req.user!.id);
        broadcastToConversation(conversationId, restartMessage);
      } else {
        // Bare `/new` repeats the latest farmer topic as an explicit fresh
        // run without adding an empty/command-only message to the transcript.
        restartMessage = previousUserMessage!;
      }

      processMessageTurnBased(
        req.user!.id,
        conversationId,
        restartMessage,
        broadcastToConversation,
        { restart: true },
      ).catch(error => {
        console.error("Error during explicit conversation restart:", error);
        broadcastToConversation(conversationId, {
          type: "error",
          message: "Failed to restart expert processing.",
        });
      });

      res.status(requestedTopic ? 201 : 200).json(restartMessage);
    } catch (error: any) {
      if (error instanceof UsageCapError) return sendUsageCapError(res, error);
      console.error("Error in POST /restart:", error);
      res.status(500).json({ message: error.message || "Internal server error" });
    }
  });
  
  app.get("/api/protected/conversations/:id/messages", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getConversation(conversationId);
      
      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      
      const messages = await storage.getConversationMessages(conversationId);
      res.json(messages);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // File upload endpoint
  app.post("/api/protected/conversations/:id/files", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }
      
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getConversation(conversationId);
      
      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      
      // Create file record
      const file = await storage.createFile({
        conversationId,
        filename: req.file.originalname,
        fileUrl: `/uploads/${req.file.filename}`,
        fileType: req.file.mimetype,
        uploadedBy: "user"
      });
      
      // Update conversation with file upload message
      const fileMessage: InsertMessage = {
        conversationId,
        userId: req.user!.id,
        expertId: null,
        content: `[Uploaded file: ${req.file.originalname}](/uploads/${req.file.filename})`,
        role: "user"
      };
      
      await storage.createMessage(fileMessage);
      
      res.status(201).json(clientFileRecord(file));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // File creation endpoint
  app.post("/api/protected/conversations/:id/generate-file", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getConversation(conversationId);
      
      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      
      const { fileType, fileName, content } = req.body;
      
      // Generate unique file name
      const uniqueId = randomBytes(8).toString("hex");
      const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9_.-]/g, "_");
      const uniqueFileName = `${uniqueId}-${sanitizedFileName}`;
      
      // Create directory if it doesn't exist
      const uploadsDir = path.join(process.cwd(), "uploads");
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      
      // Write file
      const filePath = path.join(uploadsDir, uniqueFileName);
      fs.writeFileSync(filePath, content);
      
      // Create file record
      const file = await storage.createFile({
        conversationId,
        filename: sanitizedFileName,
        fileUrl: `/uploads/${uniqueFileName}`,
        fileType: fileType || "text/plain",
        uploadedBy: "ai"
      });
      
      res.status(201).json(clientFileRecord(file));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  app.get("/api/protected/conversations/:id/files/:fileId/download", async (req, res) => {
    try {
      if (!req.isAuthenticated()) return res.status(401).json({ message: "Authentication required" });
      const conversationId = Number(req.params.id);
      const fileId = Number(req.params.fileId);
      if (!Number.isSafeInteger(conversationId) || !Number.isSafeInteger(fileId)) {
        return res.status(404).json({ message: "File not found" });
      }
      const conversation = await storage.getConversation(conversationId);
      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "File not found" });
      }
      const file = await storage.getFileById(fileId);
      if (!file || file.conversationId !== conversationId) {
        return res.status(404).json({ message: "File not found" });
      }
      const filePath = getStoredUploadPath(file);
      if (!filePath) return res.status(404).json({ message: "File not found" });
      res.setHeader("Content-Type", file.fileType);
      res.download(filePath, file.filename, error => {
        if (error && !res.headersSent) res.status(404).json({ message: "File not found" });
      });
    } catch {
      if (!res.headersSent) res.status(404).json({ message: "File not found" });
    }
  });

  // Get files for conversation
  app.get("/api/protected/conversations/:id/files", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getConversation(conversationId);
      
      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      
      const files = await storage.getConversationFiles(conversationId);
      res.json(files.map(clientFileRecord));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Insights endpoints
  app.get("/api/protected/conversations/:id/insights", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getConversation(conversationId);
      
      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      
      const insights = await storage.getConversationInsights(conversationId);
      res.json(insights);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Generate insights manually
  app.post("/api/protected/conversations/:id/generate-insights", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getConversation(conversationId);
      
      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      
      await generateInsights(conversationId);
      
      const insights = await storage.getConversationInsights(conversationId);
      res.json(insights);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
  
  // Export markdown conversation
  app.get("/api/protected/conversations/:id/export", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getConversation(conversationId);

      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      // Fetch all data
      const messages = await storage.getConversationMessages(conversationId);
      const experts = await storage.getConversationExperts(conversationId);
      const insights = await storage.getConversationInsights(conversationId);
      const files = await storage.getConversationFiles(conversationId);

      // Generate comprehensive markdown
      const markdown = generateComprehensiveMarkdown({
        conversation: {
          title: conversation.title ?? "New board session",
          createdAt: conversation.createdAt ?? new Date(0),
        },
        messages,
        experts,
        insights,
        files
      });

      // Generate filename
      const safeTitle = (conversation.title ?? "New board session")
        .replace(/[^a-z0-9]/gi, '-')
        .toLowerCase()
        .substring(0, 50);
      const date = format(conversation.createdAt ?? new Date(0), 'yyyy-MM-dd');
      const filename = `board-session-${safeTitle}-${date}.md`;

      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.send(markdown);
    } catch (error: any) {
      console.error("Export error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // Reviewed calendars use the existing versioned-file store in both storage backends.
  const calendarRequestSchema = z.object({
    events: calendarEventsSchema,
    expectedCurrentFileId: z.number().int().positive().nullable(),
    sourceFileId: z.number().int().positive().optional(),
  });

  app.get("/api/protected/conversations/:id/calendar", async (req, res) => {
    try {
      const conversationId = Number(req.params.id);
      const conversation = await storage.getConversation(conversationId);
      if (!conversation || conversation.userId !== req.user!.id) return res.status(404).json({ message: "Conversation not found" });
      let sourceFileId = req.query.fileId === undefined ? undefined : Number(req.query.fileId);
      if (sourceFileId !== undefined && (!Number.isSafeInteger(sourceFileId) || sourceFileId <= 0)) return res.status(422).json({ message: "Invalid calendar file" });
      let source = sourceFileId === undefined ? undefined : await storage.getFileById(sourceFileId);
      if (sourceFileId !== undefined && (!source || source.conversationId !== conversationId || !source.filename.toLowerCase().endsWith(".ics"))) return res.status(404).json({ message: "Calendar not found" });
      const reviewed = sourceFileId === undefined ? await storage.getCurrentDeliverableFile(conversationId, "farmer-calendar") : undefined;
      if (sourceFileId === undefined && !reviewed) {
        source = (await storage.getConversationFiles(conversationId))
          .filter(file => !file.supersededAt && file.uploadedBy.toLowerCase() !== "user" && file.filename.toLowerCase().endsWith(".ics"))
          .sort((a, b) => (b.uploadedAt?.getTime() ?? 0) - (a.uploadedAt?.getTime() ?? 0) || b.id - a.id)[0];
        sourceFileId = source?.id;
      }
      const deliverableId = source?.deliverableId?.startsWith("farmer-calendar") ? source.deliverableId : `farmer-calendar${sourceFileId ? `-${sourceFileId}` : ""}`;
      const current = reviewed ?? await storage.getCurrentDeliverableFile(conversationId, deliverableId);
      const saved = current ?? source;
      if (saved) {
        const filePath = getStoredUploadPath(saved);
        if (!filePath) return res.status(404).json({ message: "Calendar file unavailable" });
        const inspected = inspectCalendar(await fs.promises.readFile(filePath, "utf8"));
        const draft: CalendarDraft = { ...inspected, calendarName: conversation.title ?? "Board Session", currentFileId: current?.id ?? null, sourceFileId, version: current?.version ?? null };
        return res.json(draft);
      }
      const anchor = typeof req.query.start === "string" ? parseIsoDate(req.query.start) : nextMondayFrom(new Date());
      if (!anchor) return res.status(422).json({ message: "Invalid start date" });
      const rows = extractScheduleRows(await storage.getConversationMessages(conversationId), await storage.getConversationFiles(conversationId));
      if (!rows.length) return res.status(422).json({ message: "No schedulable items found. Ask the board for a dated plan first." });
      const draft: CalendarDraft = {
        events: rows.map((row, index) => ({ uid: `${conversationId}-${index}@quorum.local`, summary: buildRowSummary(row), startDate: resolveRowStartDate(row, anchor), description: row.description })),
        calendarName: conversation.title ?? "Board Session", currentFileId: null, version: null,
      };
      return res.json(draft);
    } catch {
      return res.status(422).json({ message: "This calendar could not be opened. Check that it is a valid ICS file with event start dates." });
    }
  });

  app.put("/api/protected/conversations/:id/calendar", async (req, res) => {
    let filePath: string | undefined;
    try {
      const conversationId = Number(req.params.id);
      const conversation = await storage.getConversation(conversationId);
      if (!conversation || conversation.userId !== req.user!.id) return res.status(404).json({ message: "Conversation not found" });
      const parsed = calendarRequestSchema.safeParse(req.body);
      if (!parsed.success) return res.status(422).json({ message: "Calendar requires 1–200 events with unique IDs, titles up to 75 characters, valid dates, and descriptions up to 4,000 characters." });
      const { events, expectedCurrentFileId, sourceFileId } = parsed.data;
      const source = sourceFileId ? await storage.getFileById(sourceFileId) : undefined;
      if (sourceFileId && (!source || source.conversationId !== conversationId || !source.filename.toLowerCase().endsWith(".ics"))) return res.status(404).json({ message: "Calendar not found" });
      const deliverableId = source?.deliverableId?.startsWith("farmer-calendar") ? source.deliverableId : `farmer-calendar${sourceFileId ? `-${sourceFileId}` : ""}`;
      const current = await storage.getCurrentDeliverableFile(conversationId, deliverableId);
      if ((current?.id ?? null) !== expectedCurrentFileId) return res.status(409).json({ message: "A newer calendar revision exists. Close and reopen the preview before saving." });
      const filename = "reviewed-calendar.ics";
      const diskName = `${randomBytes(16).toString("hex")}-${filename}`;
      filePath = path.join(process.cwd(), "uploads", diskName);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, buildVCalendar(events, conversation.title ?? "Board Session"), "utf8");
      const saved = await storage.saveDeliverableVersion({ conversationId, filename, fileUrl: `/uploads/${diskName}`, fileType: "text/calendar", uploadedBy: "Chair" }, {
        deliverableId, generationRequestId: randomBytes(16).toString("hex"), mode: current ? "revise" : "create", expectedCurrentFileId: current?.id, constraints: { format: "ics" },
      });
      if (!saved.created) {
        await fs.promises.unlink(filePath);
        filePath = undefined;
        return res.status(409).json({ message: "A newer calendar revision exists. Close and reopen the preview before saving." });
      }
      filePath = undefined;
      return res.json({ currentFileId: saved.file.id, version: saved.file.version, downloadUrl: authorizedFileDownloadUrl(saved.file) });
    } catch (error) {
      if (filePath) await fs.promises.unlink(filePath).catch(() => {});
      return res.status(error instanceof DeliverableConflictError ? 409 : 500).json({ message: error instanceof DeliverableConflictError ? "A newer calendar revision exists. Close and reopen the preview before saving." : "Calendar could not be saved." });
    }
  });

  // Export conversation schedule as an .ics calendar (week-by-week all-day events)
  app.get("/api/protected/conversations/:id/export.ics", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getConversation(conversationId);

      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      // Anchor date: ?start=YYYY-MM-DD (validated) or the next Monday, strictly
      // after today's UTC date (a Monday anchors to the following Monday).
      const startParam = typeof req.query.start === "string" ? req.query.start : "";
      let anchor: string;
      if (startParam) {
        const parsed = parseIsoDate(startParam);
        if (!parsed) {
          return res.status(422).json({ error: "Invalid start date. Use YYYY-MM-DD." });
        }
        anchor = parsed;
      } else {
        anchor = nextMondayFrom(new Date());
      }

      const messages = await storage.getConversationMessages(conversationId);
      const files = await storage.getConversationFiles(conversationId);

      const rows = extractScheduleRows(messages, files);
      if (rows.length === 0) {
        return res.status(422).json({
          error: "No schedulable items found in this conversation. Ask an expert for a week-by-week plan first.",
        });
      }

      const events = rows.map((row, index) => ({
        uid: `${conversationId}-${index}@quorum.local`,
        summary: buildRowSummary(row),
        startDate: resolveRowStartDate(row, anchor),
        description: row.description,
      }));

      if (req.query.preview === "1") {
        const scheduleVersions = files
          .filter((file) => !file.supersededAt && file.uploadedBy.startsWith("Expert:") && file.filename.toLowerCase().endsWith(".md"))
          .map((file) => file.version)
          .filter((version): version is number => Number.isInteger(version));
        const startDate = events.map((event) => event.startDate).sort()[0];
        return res.json({
          eventCount: events.length,
          startDate,
          year: Number(startDate.slice(0, 4)),
          timeZone: "All-day dates (timezone-neutral)",
          scheduleVersion: scheduleVersions.length ? `v${Math.max(...scheduleVersions)}` : "Current conversation schedule",
        });
      }

      const ics = buildVCalendar(events, conversation.title ?? "New board session");

      const safeTitle = (conversation.title ?? "New board session")
        .replace(/[^a-z0-9]/gi, '-')
        .toLowerCase()
        .substring(0, 50);
      const date = format(conversation.createdAt ?? new Date(0), 'yyyy-MM-dd');
      const filename = `board-session-${safeTitle}-${date}.ics`;

      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.send(ics);
    } catch (error: any) {
      console.error("ICS export error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // --- Helper function to get orchestrator instance (or handle missing state) ---
  const getOrchestratorForRequest = async (req: Request, res: Response): Promise<InteractionOrchestrator | null> => {
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getConversation(conversationId);
      if (!conversation || conversation.userId !== req.user!.id) {
          res.status(403).json({ message: "Forbidden" });
          return null;
      }
      const state = getConversationState(conversationId);
      if (!state) {
          res.status(404).json({ message: "Conversation state not found or not initialized." });
          return null;
      }
      return new InteractionOrchestrator(conversationId);
  };
  
  // --- Orchestrator Control Endpoints ---

  app.post("/api/protected/conversations/:id/pause", async (req, res) => {
    try {
      const orchestrator = await getOrchestratorForRequest(req, res);
      if (!orchestrator) return;
      
      orchestrator.pause();
      res.status(200).json({ message: "Pause signal sent." });

    } catch (error: any) {
      console.error("Error in POST /pause:", error);
      res.status(500).json({ message: error.message || "Internal server error" });
    }
  });

  app.post("/api/protected/conversations/:id/resume", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      // Ownership gate first — the same checks getOrchestratorForRequest
      // applies, but WITHOUT its missing-state 404: a paused snapshot on the
      // row is recoverable below, and this endpoint must answer exactly once.
      const conversation = await storage.getConversation(conversationId);
      if (!conversation) {
        res.status(404).json({ message: "Conversation state not found or not initialized." });
        return;
      }
      if (conversation.userId !== req.user!.id) {
        res.status(403).json({ message: "Forbidden" });
        return;
      }

      if (!getConversationState(conversationId)) {
        // No live in-memory state. A paused snapshot persisted on the row is
        // real, recoverable state (the server restarted while the council was
        // parked): rebuild the live paused state from it, then run the normal
        // resume below. Anything else keeps the 404.
        const restored = await restorePausedFromSnapshot(conversationId, broadcastToConversation);
        if (!restored) {
          res.status(404).json({ message: "Conversation state not found or not initialized." });
          return;
        }
      }

      new InteractionOrchestrator(conversationId).resume();
      res.status(200).json({ message: "Resume signal sent." });
      
    } catch (error: any) {
      console.error("Error in POST /resume:", error);
      res.status(500).json({ message: error.message || "Internal server error" });
    }
  });

  // Chair-initiated close. The board stops scheduling turns and writes the
  // decision memo immediately, without waiting for the moderator to conclude.
  app.post("/api/protected/conversations/:id/conclude", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getConversation(conversationId);
      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "Conversation not found" });
      }
      const experts = await storage.getConversationExperts(conversationId);
      if (experts.filter(expert => expert.role !== "Moderator").length === 0) {
        return res.status(409).json({ message: "Seat at least one director before closing the session." });
      }
      const history = await storage.getConversationMessages(conversationId);
      if (!history.some(message => message.role === "assistant")) {
        return res.status(409).json({ message: "The board has not spoken yet. Send a brief first, then call the question." });
      }

      // A live orchestrator owns the broadcast and stance ledger. After a
      // server restart there is no live state, but the transcript is durable —
      // the Chair can still close the session and get the memo.
      const state = getConversationState(conversationId);
      if (state) callTheQuestion(conversationId);
      const broadcast = state?.broadcastFn ?? broadcastToConversation;
      // Without live orchestrator state the in-memory stance ledger is gone,
      // but each director's last stance is persisted on its message. Rebuild
      // the ledger from the record so the memo cannot claim "no positions".
      const recordedLedger = Object.fromEntries(
        history
          .filter(message => message.expertRole && message.stance)
          .map(message => [message.expertRole as string, message.stance ?? null] as const),
      );
      const moderator = state?.moderatorExpert ?? {
        id: null,
        conversationId,
        name: "Moderator",
        role: "Moderator" as const,
        model: resolveAuxModel(null, experts.find(expert => expert.role !== "Moderator")?.model ?? null),
        systemPrompt: "",
      };
      broadcast(conversationId, { type: "concluding", conversationId });
      await generateClosingSynthesis(conversationId, moderator, broadcast, state?.stanceLedger ?? recordedLedger);
      res.status(200).json({ message: "The board has closed with a decision memo." });
    } catch (error: any) {
      console.error("Error in POST /conclude:", error);
      res.status(500).json({ message: error.message || "Could not close the session." });
    }
  });

  app.post("/api/protected/conversations/:id/autonomous/enable", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getConversation(conversationId);
      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      const body = req.body && typeof req.body === "object" ? req.body : {};
      const hasMaxTurns = Object.prototype.hasOwnProperty.call(body, "maxTurns");
      const maxTurns = body.maxTurns;
      if (hasMaxTurns && maxTurns !== null && maxTurns !== 0 &&
          (typeof maxTurns !== "number" || !Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 100)) {
        return res.status(400).json({ message: "maxTurns must be null, 0, or an integer from 1 to 100." });
      }

      if (hasMaxTurns) {
        await storage.updateConversation(conversationId, { turnBudget: maxTurns === 0 ? null : maxTurns });
      }
      await persistAutonomySettings(conversationId, {
        isAutonomousEnabled: true,
        ...(hasMaxTurns ? { maxAutonomousTurns: maxTurns === 0 ? null : maxTurns } : {}),
      });
      res.status(200).json({ message: "Autonomous mode enabled." });
      
    } catch (error: any) {
      console.error("Error in POST /autonomous/enable:", error);
      res.status(500).json({ message: error.message || "Internal server error" });
    }
  });

  app.post("/api/protected/conversations/:id/autonomous/disable", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      const conversation = await storage.getConversation(conversationId);
      if (!conversation || conversation.userId !== req.user!.id) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      await persistAutonomySettings(conversationId, { isAutonomousEnabled: false });
      res.status(200).json({ message: "Autonomous mode disabled." });
      
    } catch (error: any) {
      console.error("Error in POST /autonomous/disable:", error);
      res.status(500).json({ message: error.message || "Internal server error" });
    }
  });

  // TEST ENDPOINT - Development only
  if (DEVELOPMENT_MODE) {
    app.post("/api/dev/test-artifacts/:conversationId", async (req, res) => {
      // Hard gate: never allow dev endpoints in production
      if (process.env.NODE_ENV === "production") {
        return res.status(404).json({ message: "Not found" });
      }
      try {
        if (!req.isAuthenticated()) {
          return res.status(401).json({ message: "Not authenticated" });
        }
        const conversationId = parseInt(req.params.conversationId);
        const conversation = await storage.getConversation(conversationId);
        if (!conversation || conversation.userId !== req.user!.id) {
          return res.status(404).json({ message: "Conversation not found" });
        }
        
        // Create a test message with various artifacts
        const testMessage = {
          id: Date.now(),
          conversationId,
          expertId: 1,
          userId: null,
          content: "Here are the test artifacts you requested:",
          role: "assistant",
          expertName: "Test Expert",
          expertRole: "Test Role",
          timestamp: new Date(),
          artifacts: [
            {
              type: "json",
              title: "Customer Segment Plan",
              content: JSON.stringify({
                companyName: "Northstar Systems",
                targetAccounts: 50,
                quarters: [
                  {
                    quarter: "Q1",
                    segments: [
                      {
                        segment: "SMB",
                        accounts: 20,
                        arr: "$1.2M",
                        grossMargin: "72%",
                        retention: "91%"
                      },
                      {
                        segment: "Enterprise",
                        accounts: 30,
                        arr: "$3.8M",
                        grossMargin: "64%",
                        retention: "95%"
                      }
                    ]
                  }
                ]
              }, null, 2),
              language: "json"
            },
            {
              type: "table",
              title: "Segment Performance Results",
              content: "| Segment | ARR | Gross margin | Retention |\n|---------|-----|--------------|-----------|\n| SMB | $1.2M | 72% | 91% |\n| Enterprise | $3.8M | 64% | 95% |"
            }
          ]
        };
        
        // Directly add to storage
        const createdMessage = await storage.createMessage({
          conversationId,
          expertId: testMessage.expertId,
          userId: null,
          content: testMessage.content,
          role: testMessage.role,
          expertName: testMessage.expertName,
          expertRole: testMessage.expertRole
        });
        
        // Manually set artifacts (since InsertMessage schema doesn't include them)
        (createdMessage as any).artifacts = testMessage.artifacts;
        
        // Broadcast via WebSocket
        broadcastToConversation(conversationId, createdMessage);
        
        res.status(201).json(createdMessage);
      } catch (error: any) {
        console.error("Error creating test artifacts:", error);
        res.status(500).json({ message: error.message });
      }
    });
  }

  // ── BYOK API Key endpoints ───────────────────────────────────────────────────

  // POST /api/user/api-key — save user's OpenRouter key
  app.post("/api/user/api-key", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const { apiKey } = req.body;
      if (!apiKey || typeof apiKey !== "string") {
        return res.status(400).json({ message: "apiKey is required" });
      }

      // Validate key format (OpenRouter keys start with "sk-or-" or "sk-")
      if (!apiKey.startsWith("sk-or-") && !apiKey.startsWith("sk-")) {
        return res.status(400).json({ message: "Invalid API key format. Key must start with 'sk-or-' or 'sk-'" });
      }

      await storage.setUserApiKey(req.user!.id, apiKey);

      res.json({
        masked: maskApiKey(apiKey),
        message: "API key saved successfully",
      });
    } catch (error: any) {
      console.error("Error saving API key:", error.message);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/user/api-key/status — return masked key status
  app.get("/api/user/api-key/status", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const user = await storage.getUser(req.user!.id);
      const hasKey = !!user?.openRouterKey;
      let masked: string | null = null;

      if (hasKey && user?.openRouterKey) {
        try {
          const decrypted = await storage.getUserApiKey(req.user!.id);
          if (decrypted) {
            masked = maskApiKey(decrypted);
          }
        } catch {
          masked = "***";
        }
      }

      res.json({ hasKey, masked });
    } catch (error: any) {
      console.error("Error checking API key status:", error.message);
      res.status(500).json({ message: error.message });
    }
  });

  // DELETE /api/user/api-key — remove stored key
  app.delete("/api/user/api-key", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Authentication required" });
      }

      await storage.removeUserApiKey(req.user!.id);
      res.json({ message: "API key removed successfully" });
    } catch (error: any) {
      console.error("Error removing API key:", error.message);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/validate-openrouter-key — validate a key without storing
  app.post("/api/validate-openrouter-key", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Authentication required" });
      }

      const { apiKey } = req.body;
      if (!apiKey || typeof apiKey !== "string") {
        return res.status(400).json({ message: "apiKey is required" });
      }

      // Validate key format
      if (!apiKey.startsWith("sk-or-") && !apiKey.startsWith("sk-")) {
        return res.status(400).json({ valid: false, error: "Invalid API key format. Key must start with 'sk-or-' or 'sk-'" });
      }

      // Make a minimal OpenRouter API call to validate
      const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": "https://github.com/0-CYBERDYNE-SYSTEMS-0/quorum",
          "X-Title": "Quorum",
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (response.ok) {
        res.json({ valid: true });
      } else {
        const errorText = await response.text();
        console.log(`[BYOK] Key validation failed: ${response.status} ${errorText}`);
        res.json({ valid: false, error: `OpenRouter rejected the key (${response.status})` });
      }
    } catch (error: any) {
      console.error("Error validating API key:", error.message);
      res.status(500).json({ valid: false, error: error.message });
    }
  });

  return httpServer;
}
