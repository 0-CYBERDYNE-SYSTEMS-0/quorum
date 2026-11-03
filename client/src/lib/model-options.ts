/**
 * Client model options. The canonical slugs live in shared/models.ts so the
 * server gate and this picker can never disagree.
 *
 * Frontier models are labelled "Boardroom only" everywhere they appear: they
 * are included with the Boardroom plan and with a $15 Boardroom Session
 * credit, and are rejected with a 402 for Pro (unless the Chair adds their
 * own OpenRouter key).
 */
import {
  BOARDROOM_FRONTIER_MODEL_ALLOWLIST,
  HOUSE_KEY_PAID_MODEL_ALLOWLIST,
  MODEL_LABELS,
  modelLabel,
} from "@shared/models";

export type ModelOption = {
  id: string;
  label: string;
  boardroomOnly: boolean;
};

export const CLIENT_MODEL_OPTIONS: ModelOption[] = [
  ...HOUSE_KEY_PAID_MODEL_ALLOWLIST.map((id) => ({
    id,
    label: MODEL_LABELS[id] ?? modelLabel(id),
    boardroomOnly: false,
  })),
  ...BOARDROOM_FRONTIER_MODEL_ALLOWLIST.map((id) => ({
    id,
    label: MODEL_LABELS[id] ?? modelLabel(id),
    boardroomOnly: true,
  })),
];

/** Fast options always; frontier options only for Boardroom/Enterprise. */
export function modelOptionsForTier(tier: string | null | undefined): ModelOption[] {
  const frontierAllowed = tier === "boardroom" || tier === "enterprise";
  return CLIENT_MODEL_OPTIONS.filter((option) => frontierAllowed || !option.boardroomOnly);
}

export function isBoardroomOnlyModel(modelId: string | null | undefined): boolean {
  return Boolean(modelId && (BOARDROOM_FRONTIER_MODEL_ALLOWLIST as readonly string[]).includes(modelId));
}

export { modelLabel, BOARDROOM_FRONTIER_MODEL_ALLOWLIST, HOUSE_KEY_PAID_MODEL_ALLOWLIST };
