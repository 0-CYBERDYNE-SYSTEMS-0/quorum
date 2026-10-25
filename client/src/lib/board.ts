import type { Message } from "@shared/schema";
import { EXPERT_CATALOG } from "@shared/expert-catalog";

export const ROLE_COLORS = ["#3D4A5C", "#3F5B52", "#6B4A4A", "#8A6A3B", "#4A5568", "#5B4A63", "#3C5A63", "#6A5A3A"];

export function roleColor(role: string | null | undefined, seed = 0): string {
  const catalog = EXPERT_CATALOG.find((entry) => entry.role.toLowerCase() === (role ?? "").toLowerCase());
  if (catalog?.color) return catalog.color;
  let hash = seed;
  for (const char of role ?? "advisor") hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return ROLE_COLORS[hash % ROLE_COLORS.length];
}

export function roleEmoji(role: string | null | undefined): string {
  return EXPERT_CATALOG.find((entry) => entry.role.toLowerCase() === (role ?? "").toLowerCase())?.emoji ?? "🧑‍💼";
}

export function initialsFor(role: string | null | undefined): string {
  const words = (role ?? "Advisor").replace(/[^A-Za-z ]/g, "").split(/\s+/).filter(Boolean);
  const skip = new Set(["of", "and", "the", "for"]);
  const meaningful = words.filter((word) => !skip.has(word.toLowerCase()));
  return meaningful.slice(0, 2).map((word) => word[0]?.toUpperCase()).join("") || "QA";
}

export function clockLabel(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function dayLabel(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return "Today";
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export type StanceValue = "agree" | "disagree" | "conditional" | "abstain";

export function stanceOf(message: Message): { stance: StanceValue; confidence: number; position: string } | null {
  const raw = (message as Message & { stance?: { stance?: string; confidence?: number; position?: string } }).stance;
  if (!raw?.stance) return null;
  const stance = raw.stance.toLowerCase();
  if (!["agree", "disagree", "conditional", "abstain"].includes(stance)) return null;
  return {
    stance: stance as StanceValue,
    confidence: typeof raw.confidence === "number" ? raw.confidence : 3,
    position: raw.position ?? "",
  };
}

export const stanceLabel: Record<StanceValue, string> = {
  agree: "Agrees",
  conditional: "Conditional",
  disagree: "Dissents",
  abstain: "Abstains",
};

export const stanceTone: Record<StanceValue, "emerald" | "bronze" | "oxblood" | "neutral"> = {
  agree: "emerald",
  conditional: "bronze",
  disagree: "oxblood",
  abstain: "neutral",
};

export type BoardPreset = { id: string; name: string; blurb: string; roles: string[] };

export const BOARD_PRESETS: BoardPreset[] = [
  {
    id: "growth",
    name: "Growth board",
    blurb: "Pricing, positioning, and the next channel bet.",
    roles: ["Chief Marketing Officer", "Chief Revenue Officer", "Data & Analytics Lead", "Customer Advocate"],
  },
  {
    id: "capital",
    name: "Capital board",
    blurb: "Raise, spend, or hold. Runway and dilution in the room.",
    roles: ["Chief Financial Officer", "Chief Strategy Officer", "Corporate Development Lead", "General Counsel"],
  },
  {
    id: "operating",
    name: "Operating board",
    blurb: "Org, systems, and the machinery that has to carry the plan.",
    roles: ["Chief Operating Officer", "Chief Technology Officer", "Chief People Officer", "Risk & Compliance Lead"],
  },
  {
    id: "full",
    name: "Full board",
    blurb: "The five seats for a consequential, cross-functional call.",
    roles: ["Chief Strategy Officer", "Chief Financial Officer", "Chief Marketing Officer", "General Counsel", "Chief of Staff"],
  },
];

/** A decision prompt is treated as the charter when the session is new. */
export function charterOf(conversation: { charter?: string | null; title?: string | null } | null): string | null {
  const charter = conversation?.charter?.trim();
  return charter ? charter : null;
}

export function excerpt(value: string, limit = 140): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean;
}
