/**
 * Pricing v1: plan/session checkout, price-id → tier mapping, webhook
 * credit grants (idempotent), downgrade path, session-credit conversation
 * limits, and the custom-domain origin allowlist.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import type { Express } from "express";

process.env.DATABASE_URL = "";
process.env.SESSION_SECRET = "vitest-session-secret";
process.env.NODE_ENV = "test";
process.env.STRIPE_SECRET_KEY = "mocked_stripe_secret";
process.env.STRIPE_WEBHOOK_SECRET = "mocked_webhook_secret";
process.env.ALLOWED_ORIGIN = "https://quorum.desmond-digital.com,https://quorum-scrimwiggins.replit.app";
process.env.STRIPE_PRICE_ID_PRO = "price_pro_m";
process.env.STRIPE_PRICE_ID_PRO_ANNUAL = "price_pro_y";
process.env.STRIPE_PRICE_ID_BOARDROOM = "price_br_m";
process.env.STRIPE_PRICE_ID_BOARDROOM_ANNUAL = "price_br_y";
process.env.STRIPE_PRICE_ID_SESSION_FAST = "price_session_fast";
process.env.STRIPE_PRICE_ID_SESSION_BOARDROOM = "price_session_br";

const {
  mockCustomerCreate,
  mockSessionCreate,
  mockSubscriptionRetrieve,
  mockSubscriptionUpdate,
  mockPortalCreate,
  mockConstructEvent,
} = vi.hoisted(() => ({
  mockCustomerCreate: vi.fn(),
  mockSessionCreate: vi.fn(),
  mockSubscriptionRetrieve: vi.fn(),
  mockSubscriptionUpdate: vi.fn(),
  mockPortalCreate: vi.fn(),
  mockConstructEvent: vi.fn(),
}));

vi.mock("stripe", () => {
  const MockStripe = vi.fn();
  MockStripe.prototype.customers = { create: mockCustomerCreate };
  MockStripe.prototype.checkout = { sessions: { create: mockSessionCreate } };
  MockStripe.prototype.subscriptions = {
    create: vi.fn(),
    retrieve: mockSubscriptionRetrieve,
    update: mockSubscriptionUpdate,
    cancel: vi.fn(),
  };
  MockStripe.prototype.billingPortal = { sessions: { create: mockPortalCreate } };
  MockStripe.prototype.webhooks = { constructEvent: mockConstructEvent };
  return { default: MockStripe };
});

import {
  allowedOriginsFromEnv,
  isAllowedOrigin,
  parseCheckoutRequest,
  resolveReturnOrigin,
  resolveSessionPriceId,
  resolveSubscriptionPriceId,
  tierForSubscriptionPriceId,
  checkoutUrls,
} from "../server/billing-plans";
import { resolveExpertModelForContext } from "../shared/expert-catalog";
import { BOARDROOM_FRONTIER_MODEL_ALLOWLIST, HOUSE_KEY_PAID_MODEL_ALLOWLIST } from "../shared/models";

let app: Express;

beforeAll(async () => {
  const { registerRoutes } = await import("../server/routes");
  app = express();
  app.use(express.json());
  await registerRoutes(app);
});

beforeEach(() => {
  mockCustomerCreate.mockReset().mockResolvedValue({ id: "cus_pricing" });
  mockSessionCreate.mockReset().mockResolvedValue({ url: "https://checkout.stripe.test/s" });
  mockSubscriptionRetrieve.mockReset();
  mockSubscriptionUpdate.mockReset().mockResolvedValue({});
  mockPortalCreate.mockReset().mockResolvedValue({ url: "https://billing.stripe.test/p" });
  mockConstructEvent.mockReset();
});

async function registerUser(username: string) {
  const agent = request.agent(app);
  const res = await agent.post("/api/register").send({ username, password: "pass12345", email: `${username}@example.com` });
  expect(res.status).toBe(201);
  return { agent, userId: res.body.id as number };
}

function webhookEvent(event: unknown) {
  mockConstructEvent.mockReturnValue(event);
  return request(app).post("/api/webhook").set("stripe-signature", "sig").send(JSON.stringify(event));
}

describe("pricing v1: pure checkout plumbing", () => {
  it("maps plan + interval to the environment price name", () => {
    expect(resolveSubscriptionPriceId("pro", "month")).toEqual({ envName: "STRIPE_PRICE_ID_PRO", priceId: "price_pro_m" });
    expect(resolveSubscriptionPriceId("pro", "year")).toEqual({ envName: "STRIPE_PRICE_ID_PRO_ANNUAL", priceId: "price_pro_y" });
    expect(resolveSubscriptionPriceId("boardroom", "month")).toEqual({ envName: "STRIPE_PRICE_ID_BOARDROOM", priceId: "price_br_m" });
    expect(resolveSubscriptionPriceId("boardroom", "year")).toEqual({ envName: "STRIPE_PRICE_ID_BOARDROOM_ANNUAL", priceId: "price_br_y" });
    expect(resolveSessionPriceId("fast")).toEqual({ envName: "STRIPE_PRICE_ID_SESSION_FAST", priceId: "price_session_fast" });
    expect(resolveSessionPriceId("boardroom")).toEqual({ envName: "STRIPE_PRICE_ID_SESSION_BOARDROOM", priceId: "price_session_br" });
  });

  it("maps every configured price id back to a tier and ignores unknowns", () => {
    expect(tierForSubscriptionPriceId("price_pro_m")).toBe("pro");
    expect(tierForSubscriptionPriceId("price_pro_y")).toBe("pro");
    expect(tierForSubscriptionPriceId("price_br_m")).toBe("boardroom");
    expect(tierForSubscriptionPriceId("price_br_y")).toBe("boardroom");
    expect(tierForSubscriptionPriceId("price_unknown")).toBeUndefined();
    expect(tierForSubscriptionPriceId(null)).toBeUndefined();
  });

  it("parses checkout bodies: legacy default, plan, and session", () => {
    expect(parseCheckoutRequest({})).toEqual({ ok: true, value: { mode: "subscription", plan: "pro", interval: "month" } });
    expect(parseCheckoutRequest({ interval: "year" })).toEqual({ ok: true, value: { mode: "subscription", plan: "pro", interval: "year" } });
    expect(parseCheckoutRequest({ plan: "boardroom", interval: "month" })).toEqual({ ok: true, value: { mode: "subscription", plan: "boardroom", interval: "month" } });
    expect(parseCheckoutRequest({ session: "boardroom" })).toEqual({ ok: true, value: { mode: "payment", sessionKind: "boardroom" } });
    expect(parseCheckoutRequest({ plan: "gold" }).ok).toBe(false);
    expect(parseCheckoutRequest({ session: "mega" }).ok).toBe(false);
    expect(parseCheckoutRequest({ plan: "pro", session: "fast" }).ok).toBe(false);
  });

  it("allows both hosts and falls back to the first configured origin", () => {
    expect(allowedOriginsFromEnv()).toEqual([
      "https://quorum.desmond-digital.com",
      "https://quorum-scrimwiggins.replit.app",
    ]);
    expect(isAllowedOrigin("https://quorum.desmond-digital.com")).toBe(true);
    expect(isAllowedOrigin("https://quorum.desmond-digital.com/")).toBe(true);
    expect(isAllowedOrigin("https://evil.example")).toBe(false);
    expect(resolveReturnOrigin("https://quorum-scrimwiggins.replit.app")).toBe("https://quorum-scrimwiggins.replit.app");
    expect(resolveReturnOrigin("https://evil.example")).toBe("https://quorum.desmond-digital.com");
    expect(resolveReturnOrigin(undefined)).toBe("https://quorum.desmond-digital.com");
    expect(checkoutUrls("https://quorum.desmond-digital.com", "success").successUrl)
      .toBe("https://quorum.desmond-digital.com/?checkout=success");
  });
});

describe("pricing v1: POST /api/create-checkout-session", () => {
  const pricePassed = () => mockSessionCreate.mock.calls[0][0].line_items[0].price;

  it("creates a Pro monthly subscription by default", async () => {
    const { agent } = await registerUser("checkout_pro_default");
    const res = await agent.post("/api/create-checkout-session").send({});
    expect(res.status).toBe(200);
    expect(pricePassed()).toBe("price_pro_m");
    expect(mockSessionCreate.mock.calls[0][0].mode).toBe("subscription");
    expect(mockSessionCreate.mock.calls[0][0].metadata).toMatchObject({ plan: "pro" });
  });

  it("creates Pro annual, Boardroom monthly and Boardroom annual sessions", async () => {
    const { agent } = await registerUser("checkout_plans");
    await agent.post("/api/create-checkout-session").send({ plan: "pro", interval: "year" });
    expect(pricePassed()).toBe("price_pro_y");
    mockSessionCreate.mockClear();
    await agent.post("/api/create-checkout-session").send({ plan: "boardroom", interval: "month" });
    expect(pricePassed()).toBe("price_br_m");
    mockSessionCreate.mockClear();
    await agent.post("/api/create-checkout-session").send({ plan: "boardroom", interval: "year" });
    expect(pricePassed()).toBe("price_br_y");
  });

  it("creates one-time session checkouts with kind metadata", async () => {
    const { agent, userId } = await registerUser("checkout_sessions");
    await agent.post("/api/create-checkout-session").send({ session: "fast" });
    expect(mockSessionCreate.mock.calls[0][0].mode).toBe("payment");
    expect(pricePassed()).toBe("price_session_fast");
    expect(mockSessionCreate.mock.calls[0][0].metadata).toMatchObject({ userId: String(userId), sessionKind: "fast" });

    mockSessionCreate.mockClear();
    await agent.post("/api/create-checkout-session").send({ session: "boardroom" });
    expect(pricePassed()).toBe("price_session_br");
    expect(mockSessionCreate.mock.calls[0][0].metadata).toMatchObject({ sessionKind: "boardroom" });
  });

  it("uses the request origin only when allowed (custom domain readiness)", async () => {
    const { agent } = await registerUser("checkout_origin");
    await agent.post("/api/create-checkout-session")
      .set("Origin", "https://quorum.desmond-digital.com")
      .send({ plan: "pro" });
    expect(mockSessionCreate.mock.calls[0][0].success_url).toBe("https://quorum.desmond-digital.com/?checkout=success");

    mockSessionCreate.mockClear();
    await agent.post("/api/create-checkout-session")
      .set("Origin", "https://evil.example")
      .send({ plan: "pro" });
    expect(mockSessionCreate.mock.calls[0][0].success_url).toBe("https://quorum.desmond-digital.com/?checkout=success");
  });

  it("keeps the readable billing-unavailable message for the missing option only", async () => {
    const { agent } = await registerUser("checkout_missing_price");
    const saved = process.env.STRIPE_PRICE_ID_SESSION_BOARDROOM;
    delete process.env.STRIPE_PRICE_ID_SESSION_BOARDROOM;
    const missing = await agent.post("/api/create-checkout-session").send({ session: "boardroom" });
    expect(missing.status).toBe(503);
    expect(missing.body.code).toBe("BILLING_UNAVAILABLE");
    process.env.STRIPE_PRICE_ID_SESSION_BOARDROOM = saved;

    const ok = await agent.post("/api/create-checkout-session").send({ session: "fast" });
    expect(ok.status).toBe(200);
  });

  it("rejects invalid plan/session combinations before calling Stripe", async () => {
    const { agent } = await registerUser("checkout_invalid");
    const res = await agent.post("/api/create-checkout-session").send({ plan: "platinum" });
    expect(res.status).toBe(400);
    expect(mockSessionCreate).not.toHaveBeenCalled();
  });
});

describe("pricing v1: webhook", () => {
  it("grants a session credit exactly once (idempotent on checkout session id)", async () => {
    const { agent, userId } = await registerUser("hook_credit");
    const event = {
      type: "checkout.session.completed",
      data: { object: { id: "cs_credit_1", mode: "payment", payment_status: "paid", customer: "cus_pricing", metadata: { userId: String(userId), sessionKind: "fast" } } },
    };
    expect((await webhookEvent(event)).status).toBe(200);
    let tier = await agent.get("/api/user/tier");
    expect(tier.body.sessionCredits).toMatchObject({ available: 1, fast: 1, boardroom: 0 });

    // Stripe replays the same delivery: still exactly one credit.
    expect((await webhookEvent(event)).status).toBe(200);
    tier = await agent.get("/api/user/tier");
    expect(tier.body.sessionCredits).toMatchObject({ available: 1, fast: 1, used: 0 });
  });

  it("does not grant a credit until a delayed payment succeeds", async () => {
    const { agent, userId } = await registerUser("hook_delayed");
    const base = {
      id: "cs_delayed",
      mode: "payment",
      customer: "cus_delayed",
      metadata: { userId: String(userId), sessionKind: "boardroom" },
    };
    await webhookEvent({
      type: "checkout.session.completed",
      data: { object: { ...base, payment_status: "unpaid" } },
    });
    expect((await agent.get("/api/user/tier")).body.sessionCredits.available).toBe(0);

    await webhookEvent({
      type: "checkout.session.async_payment_succeeded",
      data: { object: { ...base, payment_status: "paid" } },
    });
    expect((await agent.get("/api/user/tier")).body.sessionCredits).toMatchObject({ available: 1, boardroom: 1 });
  });

  it("does not grant a one-time credit for a no_payment_required payment session", async () => {
    const { agent, userId } = await registerUser("hook_payment_nopay");
    await webhookEvent({
      type: "checkout.session.completed",
      data: { object: { id: "cs_nopay", mode: "payment", payment_status: "no_payment_required", customer: "cus_nopay", metadata: { userId: String(userId), sessionKind: "fast" } } },
    });
    expect((await agent.get("/api/user/tier")).body.sessionCredits.available).toBe(0);
  });

  it("grants a subscription only after payment, and allows a trial with no_payment_required", async () => {
    const { agent, userId } = await registerUser("hook_sub_unpaid");
    await webhookEvent({
      type: "checkout.session.completed",
      data: { object: { id: "cs_unpaid", mode: "subscription", payment_status: "unpaid", customer: "cus_unpaid", subscription: "sub_unpaid", metadata: { userId: String(userId), plan: "pro" } } },
    });
    expect((await agent.get("/api/user/tier")).body.tier).toBe("free");

    await webhookEvent({
      type: "checkout.session.async_payment_succeeded",
      data: { object: { id: "cs_unpaid", mode: "subscription", payment_status: "paid", customer: "cus_unpaid", subscription: "sub_unpaid", metadata: { userId: String(userId), plan: "pro" } } },
    });
    expect((await agent.get("/api/user/tier")).body.tier).toBe("pro");

    const trial = await registerUser("hook_trial");
    await webhookEvent({
      type: "checkout.session.completed",
      data: { object: { id: "cs_trial", mode: "subscription", payment_status: "no_payment_required", customer: "cus_trial", subscription: "sub_trial", metadata: { userId: String(trial.userId), plan: "boardroom" } } },
    });
    expect((await trial.agent.get("/api/user/tier")).body.tier).toBe("boardroom");
  });

  it("answers non-2xx when a handler throws so Stripe retries", async () => {
    mockConstructEvent.mockReturnValue({
      type: "invoice.payment_succeeded",
      data: { object: { get subscription(): string { throw new Error("db unavailable"); } } },
    });
    const res = await request(app).post("/api/webhook").set("stripe-signature", "sig").send({});
    expect(res.status).toBe(500);
  });

  it("sets the plan from checkout metadata and maps price ids on subscription.updated", async () => {
    const { agent, userId } = await registerUser("hook_sub");
    await webhookEvent({
      type: "checkout.session.completed",
      data: { object: { id: "cs_sub", mode: "subscription", payment_status: "paid", customer: "cus_sub", subscription: "sub_1", metadata: { userId: String(userId), plan: "pro" } } },
    });
    let tier = await agent.get("/api/user/tier");
    expect(tier.body.tier).toBe("pro");

    await webhookEvent({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", customer: "cus_sub", status: "active", items: { data: [{ price: { id: "price_br_y" } }] } } },
    });
    tier = await agent.get("/api/user/tier");
    expect(tier.body.tier).toBe("boardroom");

    await webhookEvent({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1", customer: "cus_sub", status: "past_due", items: { data: [{ price: { id: "price_br_y" } }] } } },
    });
    const status = await agent.get("/api/subscription-status");
    expect(status.body.status).toBe("past_due");
    tier = await agent.get("/api/user/tier");
    expect(tier.body.tier).toBe("boardroom");
  });

  it("downgrades to free when the subscription is deleted", async () => {
    const { agent, userId } = await registerUser("hook_delete");
    await webhookEvent({
      type: "checkout.session.completed",
      data: { object: { id: "cs_del", mode: "subscription", payment_status: "paid", customer: "cus_del", subscription: "sub_del", metadata: { userId: String(userId), plan: "boardroom" } } },
    });
    let tier = await agent.get("/api/user/tier");
    expect(tier.body.tier).toBe("boardroom");

    await webhookEvent({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_del", customer: "cus_del", status: "canceled" } },
    });
    tier = await agent.get("/api/user/tier");
    expect(tier.body.tier).toBe("free");
    const status = await agent.get("/api/subscription-status");
    expect(status.body.status).toBe("canceled");
  });

  it("marks past_due on invoice.payment_failed and active on invoice.payment_succeeded", async () => {
    const { agent, userId } = await registerUser("hook_invoice");
    await webhookEvent({
      type: "checkout.session.completed",
      data: { object: { id: "cs_inv", mode: "subscription", payment_status: "paid", customer: "cus_inv", subscription: "sub_inv", metadata: { userId: String(userId), plan: "pro" } } },
    });
    await webhookEvent({ type: "invoice.payment_failed", data: { object: { subscription: "sub_inv" } } });
    expect((await agent.get("/api/subscription-status")).body.status).toBe("past_due");
    await webhookEvent({ type: "invoice.payment_succeeded", data: { object: { subscription: "sub_inv" } } });
    expect((await agent.get("/api/subscription-status")).body.status).toBe("active");
    expect((await agent.get("/api/user/tier")).body.tier).toBe("pro");
  });
});

describe("pricing v1: session credit conversations", () => {
  it("does not spend a held credit on an ordinary Free board", async () => {
    const { agent, userId } = await registerUser("credit_optin");
    await webhookEvent({
      type: "checkout.session.completed",
      data: { object: { id: "cs_optin", mode: "payment", payment_status: "paid", customer: "cus_optin", metadata: { userId: String(userId), sessionKind: "boardroom" } } },
    });

    const freeBoard = await agent.post("/api/protected/conversations").send({ title: "Free board" });
    expect(freeBoard.status).toBe(201);
    expect(freeBoard.body.sessionCreditKind).toBeNull();
    expect((await agent.get("/api/user/tier")).body.sessionCredits).toMatchObject({ available: 1, boardroom: 1 });

    // Choosing the session board spends exactly that credit.
    const credited = await agent.post("/api/protected/conversations").send({ title: "Chosen", sessionCreditKind: "boardroom" });
    expect(credited.body.sessionCreditKind).toBe("boardroom");
    expect((await agent.get("/api/user/tier")).body.sessionCredits).toMatchObject({ available: 0, used: 1 });
  });

  it("refuses an explicit credit kind the account does not hold", async () => {
    const { agent } = await registerUser("credit_missing");
    const res = await agent.post("/api/protected/conversations").send({ title: "No credit", sessionCreditKind: "fast" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SESSION_CREDIT_UNAVAILABLE");
  });

  it("consumes one credit for one conversation and applies its seat cap", async () => {
    const { agent, userId } = await registerUser("credit_conv");
    await webhookEvent({
      type: "checkout.session.completed",
      data: { object: { id: "cs_conv", mode: "payment", payment_status: "paid", customer: "cus_conv", metadata: { userId: String(userId), sessionKind: "fast" } } },
    });

    const first = await agent.post("/api/protected/conversations").send({ title: "On the credit", sessionCreditKind: "fast" });
    expect(first.status).toBe(201);
    expect(first.body.sessionCreditKind).toBe("fast");

    // Fast credit allows five seats (the Free plan alone allows three). A
    // ':free' model request is rewritten to the credit's paid default.
    for (let seat = 1; seat <= 5; seat += 1) {
      const added = await agent.post(`/api/protected/conversations/${first.body.id}/experts`).send({
        name: `Director ${seat}`,
        role: `Director role ${seat}`,
        model: "google/gemma-4-31b-it:free",
      });
      expect(added.status).toBe(201);
      expect(added.body.model.endsWith(":free")).toBe(false);
    }
    const sixth = await agent.post(`/api/protected/conversations/${first.body.id}/experts`).send({
      name: "Director 6",
      role: "Director role 6",
      model: "google/gemma-4-31b-it:free",
    });
    expect(sixth.status).toBe(403);
    expect(sixth.body).toMatchObject({ code: "TIER_LIMIT_EXPERTS", limit: 5 });

    // The credit is spent: the next conversation is back on the Free plan.
    const second = await agent.post("/api/protected/conversations").send({ title: "Free again" });
    expect(second.body.sessionCreditKind).toBeNull();
    const tier = await agent.get("/api/user/tier");
    expect(tier.body.sessionCredits).toMatchObject({ available: 0, used: 1 });
  });

  it("gates frontier models for Pro but allows them on a Boardroom credit", async () => {
    const { agent, userId } = await registerUser("credit_frontier");
    // Free plan, no credit: paid model is rejected.
    const freeConv = await agent.post("/api/protected/conversations").send({ title: "Free" });
    const denied = await agent.post(`/api/protected/conversations/${freeConv.body.id}/experts`).send({
      name: "Frontier",
      role: "Frontier seat",
      model: "anthropic/claude-opus-5.5",
    });
    expect(denied.status).toBe(402);
    expect(denied.body.code).toBe("paid_model_requires_pro");

    // A Boardroom Session credit unlocks frontier models for its conversation.
    await webhookEvent({
      type: "checkout.session.completed",
      data: { object: { id: "cs_frontier", mode: "payment", payment_status: "paid", customer: "cus_f", metadata: { userId: String(userId), sessionKind: "boardroom" } } },
    });
    const credited = await agent.post("/api/protected/conversations").send({ title: "Boardroom session", sessionCreditKind: "boardroom" });
    expect(credited.body.sessionCreditKind).toBe("boardroom");
    const allowed = await agent.post(`/api/protected/conversations/${credited.body.id}/experts`).send({
      name: "Frontier",
      role: "Frontier seat",
      model: "anthropic/claude-opus-5.5",
    });
    expect(allowed.status).toBe(201);
  });
});

describe("pricing v1: paid expert model defaults", () => {
  it("rewrites a free seat on Pro and Boardroom, on create and update", async () => {
    const { agent, userId } = await registerUser("expert_models");
    await webhookEvent({
      type: "checkout.session.completed",
      data: { object: { id: "cs_models_pro", mode: "subscription", payment_status: "paid", customer: "cus_models", subscription: "sub_models", metadata: { userId: String(userId), plan: "pro" } } },
    });

    const proConv = await agent.post("/api/protected/conversations").send({ title: "Pro board" });
    const proSeat = await agent.post(`/api/protected/conversations/${proConv.body.id}/experts`).send({
      name: "Chief Strategy Officer",
      role: "Chief Strategy Officer",
      model: "poolside/laguna-s-2.1:free",
    });
    expect(proSeat.status).toBe(201);
    expect(proSeat.body.model.endsWith(":free")).toBe(false);
    expect(HOUSE_KEY_PAID_MODEL_ALLOWLIST as readonly string[]).toContain(proSeat.body.model);

    // The settings route applies the same rewrite.
    const patched = await agent.patch(`/api/experts/${proSeat.body.id}`).send({ model: "google/gemma-4-31b-it:free" });
    expect(patched.status).toBe(200);
    expect(patched.body.model.endsWith(":free")).toBe(false);
    expect(HOUSE_KEY_PAID_MODEL_ALLOWLIST as readonly string[]).toContain(patched.body.model);

    // Upgrading to Boardroom seats the frontier default.
    await webhookEvent({
      type: "customer.subscription.updated",
      data: { object: { id: "sub_models", customer: "cus_models", status: "active", items: { data: [{ price: { id: "price_br_y" } }] } } },
    });
    const brConv = await agent.post("/api/protected/conversations").send({ title: "Boardroom board" });
    const brSeat = await agent.post(`/api/protected/conversations/${brConv.body.id}/experts`).send({
      name: "Chief Financial Officer",
      role: "Chief Financial Officer",
      model: "poolside/laguna-s-2.1:free",
    });
    expect(brSeat.status).toBe(201);
    expect(BOARDROOM_FRONTIER_MODEL_ALLOWLIST as readonly string[]).toContain(brSeat.body.model);
    expect(brSeat.body.model).toBe(resolveExpertModelForContext("poolside/laguna-s-2.1:free", { paid: true, allowFrontier: true }));
  });
});

describe("pricing v1: plan changes and billing portal", () => {
  it("switches an active Pro subscriber to Boardroom in place", async () => {
    const { agent, userId } = await registerUser("upgrade_switch");
    await webhookEvent({
      type: "checkout.session.completed",
      data: { object: { id: "cs_up", mode: "subscription", payment_status: "paid", customer: "cus_up", subscription: "sub_up", metadata: { userId: String(userId), plan: "pro" } } },
    });
    mockSubscriptionRetrieve.mockResolvedValue({
      id: "sub_up",
      status: "active",
      items: { data: [{ id: "si_up", price: { id: "price_pro_m" } }] },
    });

    const res = await agent.post("/api/create-checkout-session").send({ plan: "boardroom", interval: "month" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ updated: true, plan: "boardroom" });
    expect(mockSubscriptionUpdate).toHaveBeenCalledWith("sub_up", expect.objectContaining({
      items: [{ id: "si_up", price: "price_br_m" }],
      proration_behavior: "create_prorations",
    }));
    // No second Checkout session: the Chair cannot hold two subscriptions.
    expect(mockSessionCreate).not.toHaveBeenCalled();
    expect((await agent.get("/api/user/tier")).body.tier).toBe("boardroom");
  });

  it("opens the Stripe customer portal for an account with a customer id", async () => {
    const { agent, userId } = await registerUser("portal_user");
    await webhookEvent({
      type: "checkout.session.completed",
      data: { object: { id: "cs_portal", mode: "subscription", payment_status: "paid", customer: "cus_portal", subscription: "sub_portal", metadata: { userId: String(userId), plan: "pro" } } },
    });
    const res = await agent.post("/api/billing-portal").send({});
    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://billing.stripe.test/p");
    expect(mockPortalCreate.mock.calls[0][0].customer).toBe("cus_portal");
  });
});
