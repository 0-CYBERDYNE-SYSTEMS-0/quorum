import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Plus, Sparkles, UserRound, X } from "lucide-react";
import type { Expert } from "@shared/schema";
import { EXPERT_CATALOG, TIER_EXPERT_LIMITS, type CatalogExpert } from "@shared/expert-catalog";
import { Btn, Chip, Field, Input, Modal, Monogram, TextArea } from "@/components/design";
import { BOARD_PRESETS } from "@/lib/board";
import { cn } from "@/lib/utils";

type SeatDraft = {
  key: string;
  role: string;
  name: string;
  model: string;
  avatarUrl: string;
  customInstructions?: string;
  existingId?: number;
  custom?: boolean;
};

function toDraft(expert: Expert): SeatDraft {
  return {
    key: `existing-${expert.id}`,
    role: expert.role,
    name: expert.name,
    model: expert.model,
    avatarUrl: expert.avatarUrl ?? "",
    customInstructions: expert.customInstructions ?? undefined,
    existingId: expert.id,
  };
}

function fromCatalog(entry: CatalogExpert): SeatDraft {
  return {
    key: `catalog-${entry.role}`,
    role: entry.role,
    name: entry.role,
    model: entry.defaultModel,
    avatarUrl: entry.color,
  };
}

export function BoardModal({
  open,
  onOpenChange,
  experts,
  tier,
  onApply,
  onUpdateSeat,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  experts: Expert[];
  tier: string;
  onApply: (adds: SeatDraft[], removes: number[]) => Promise<void>;
  onUpdateSeat: (expertId: number, body: { customInstructions?: string }) => Promise<void>;
}) {
  const limit = TIER_EXPERT_LIMITS[(tier as keyof typeof TIER_EXPERT_LIMITS)] ?? TIER_EXPERT_LIMITS.free;
  const [drafts, setDrafts] = useState<SeatDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [category, setCategory] = useState<string>("All");
  const [customOpen, setCustomOpen] = useState(false);
  const [customRole, setCustomRole] = useState("");
  const [customName, setCustomName] = useState("");
  const [customBrief, setCustomBrief] = useState("");
  const [editingBrief, setEditingBrief] = useState<string | null>(null);
  const [briefDraft, setBriefDraft] = useState("");

  useEffect(() => {
    if (open) {
      setDrafts(experts.map(toDraft));
      setCategory("All");
      setCustomOpen(false);
    }
  }, [open, experts]);

  const selectedRoles = useMemo(() => new Set(drafts.map((draft) => draft.role.toLowerCase())), [drafts]);
  const categories = useMemo(() => ["All", ...Array.from(new Set(EXPERT_CATALOG.map((entry) => entry.category)))], []);
  const visible = EXPERT_CATALOG.filter((entry) => category === "All" || entry.category === category);
  const atLimit = drafts.length >= limit;

  const toggle = (entry: CatalogExpert) => {
    setDrafts((current) => {
      const existing = current.find((draft) => draft.role.toLowerCase() === entry.role.toLowerCase());
      if (existing) return current.filter((draft) => draft !== existing);
      if (current.length >= limit) return current;
      return [...current, fromCatalog(entry)];
    });
  };

  const applyPreset = (roles: string[]) => {
    const next = roles
      .map((role) => EXPERT_CATALOG.find((entry) => entry.role === role))
      .filter((entry): entry is CatalogExpert => !!entry)
      .slice(0, limit)
      .map((entry) => drafts.find((draft) => draft.role === entry.role) ?? fromCatalog(entry));
    setDrafts(next);
  };

  const addCustom = () => {
    if (!customRole.trim() || atLimit) return;
    setDrafts((current) => [
      ...current,
      {
        key: `custom-${customRole.trim()}-${Date.now()}`,
        role: customRole.trim(),
        name: customName.trim() || customRole.trim(),
        model: EXPERT_CATALOG[1]?.defaultModel ?? EXPERT_CATALOG[0].defaultModel,
        avatarUrl: "#5B4A63",
        customInstructions: customBrief.trim() || undefined,
        custom: true,
      },
    ]);
    setCustomRole("");
    setCustomName("");
    setCustomBrief("");
    setCustomOpen(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const keptIds = new Set(drafts.map((draft) => draft.existingId).filter(Boolean) as number[]);
      const removes = experts.filter((expert) => !keptIds.has(expert.id)).map((expert) => expert.id);
      const adds = drafts.filter((draft) => !draft.existingId);
      for (const draft of drafts) {
        if (!draft.existingId) continue;
        const original = experts.find((expert) => expert.id === draft.existingId);
        if (original && (original.customInstructions ?? "") !== (draft.customInstructions ?? "")) {
          await onUpdateSeat(draft.existingId, { customInstructions: draft.customInstructions ?? "" });
        }
      }
      await onApply(adds, removes);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="The board"
      description={`Seat directors for this session. ${limit === 999 ? "Unlimited seats" : `${drafts.length} of ${limit} seats used`}.`}
      footer={
        <>
          <span className="mr-auto text-[11px] text-faint-ink">
            Each seat carries a functional brief and argues from it.
          </span>
          <Btn variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Btn>
          <Btn variant="bronze" size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Save board
          </Btn>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <div className="flex flex-wrap gap-1.5">
            {BOARD_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.roles)}
                title={preset.blurb}
                className="rounded-full border border-line-strong bg-surface px-2.5 py-1 text-[10.5px] font-medium text-muted-ink transition-colors hover:border-bronze/40 hover:text-ink"
              >
                {preset.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCustomOpen((open) => !open)}
              className="flex items-center gap-1 rounded-full border border-dashed border-line-strong px-2.5 py-1 text-[10.5px] text-faint-ink hover:border-bronze/40 hover:text-ink"
            >
              <Plus className="h-3 w-3" /> Custom
            </button>
          </div>

          {customOpen && (
            <div className="mt-3 rounded-lg border border-line bg-paper/60 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Role">
                  <Input value={customRole} onChange={(event) => setCustomRole(event.target.value)} placeholder="e.g. Operating partner" className="h-9" />
                </Field>
                <Field label="Name" hint="optional">
                  <Input value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="Display name" className="h-9" />
                </Field>
              </div>
              <Field label="Standing brief" hint="optional" className="mt-2">
                <TextArea
                  value={customBrief}
                  onChange={(event) => setCustomBrief(event.target.value)}
                  placeholder="What this director owns, what they demand evidence for, and what they hand off."
                  className="min-h-[64px] text-[12.5px]"
                />
              </Field>
              <div className="mt-2 flex justify-end">
                <Btn size="sm" variant="primary" onClick={addCustom} disabled={!customRole.trim() || atLimit}>
                  Add seat
                </Btn>
              </div>
            </div>
          )}

          <div className="mt-5 flex flex-nowrap gap-1 overflow-x-auto border-b border-line pb-2 [scrollbar-width:none]">
            {categories.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setCategory(value)}
                className={cn(
                  "shrink-0 whitespace-nowrap rounded px-2 py-1 text-[11px] transition-colors",
                  category === value ? "bg-ink text-paper" : "text-muted-ink hover:bg-slatewash hover:text-ink",
                )}
              >
                {value}
              </button>
            ))}
          </div>

          <ul className="mt-2 max-h-[340px] space-y-1 overflow-y-auto pr-1">
            {visible.map((entry) => {
              const seated = selectedRoles.has(entry.role.toLowerCase());
              return (
                <li key={entry.role}>
                  <button
                    type="button"
                    onClick={() => toggle(entry)}
                    disabled={!seated && atLimit}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      seated
                        ? "border-bronze/35 bg-bronze-wash/50"
                        : "border-line/60 bg-surface/40 hover:border-line-strong hover:bg-surface",
                      !seated && atLimit && "cursor-not-allowed opacity-40",
                    )}
                  >
                    <span
                      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px]"
                      style={{ background: `${entry.color}1F`, color: entry.color }}
                    >
                      {entry.emoji}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-[12.5px] font-medium text-ink">{entry.role}</span>
                        {entry.recommended && !seated && (
                          <span className="text-[9.5px] uppercase tracking-[0.1em] text-bronze">Core</span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-ink">{entry.description}</span>
                    </span>
                    <span
                      className={cn(
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                        seated ? "border-bronze bg-bronze text-white" : "border-line-strong text-transparent",
                      )}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-lg border border-line bg-paper/50 p-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-faint-ink">Seated</p>
            <Chip tone={atLimit ? "bronze" : "neutral"}>{drafts.length}/{limit === 999 ? "∞" : limit}</Chip>
          </div>

          {drafts.length === 0 ? (
            <div className="mt-6 rounded-lg border border-dashed border-line-strong px-4 py-8 text-center">
              <UserRound className="mx-auto h-4 w-4 text-faint-ink" />
              <p className="mt-2 text-[12px] font-medium text-ink-soft">An empty table</p>
              <p className="mt-1 text-[11px] leading-relaxed text-faint-ink">
                Pick a preset or choose individual functions from the left.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {drafts.map((draft) => {
                const entry = EXPERT_CATALOG.find((catalog) => catalog.role === draft.role);
                return (
                  <li key={draft.key} className="rounded-lg border border-line bg-surface p-2.5">
                    <div className="flex items-start gap-2.5">
                      <Monogram name={draft.role} color={entry?.color ?? draft.avatarUrl ?? "#5B4A63"} size={26} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-ink">{draft.role}</p>
                        <p className="truncate text-[10.5px] text-faint-ink">
                          {entry?.category ?? "Custom"} · {draft.model.split("/").pop()}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setDrafts((current) => current.filter((item) => item.key !== draft.key))}
                        className="rounded p-1 text-faint-ink hover:bg-slatewash hover:text-oxblood"
                        aria-label={`Remove ${draft.role}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    {draft.existingId && (
                      <div className="mt-2">
                        {editingBrief === draft.key ? (
                          <div>
                            <TextArea
                              autoFocus
                              value={briefDraft}
                              onChange={(event) => setBriefDraft(event.target.value)}
                              placeholder="Standing instructions for this seat…"
                              className="min-h-[60px] text-[11.5px]"
                            />
                            <div className="mt-1 flex justify-end gap-1">
                              <Btn variant="ghost" size="sm" className="h-6 px-2 text-[10.5px]" onClick={() => setEditingBrief(null)}>
                                Cancel
                              </Btn>
                              <Btn
                                variant="primary"
                                size="sm"
                                className="h-6 px-2 text-[10.5px]"
                                onClick={() => {
                                  setDrafts((current) =>
                                    current.map((item) =>
                                      item.key === draft.key ? { ...item, customInstructions: briefDraft } : item,
                                    ),
                                  );
                                  setEditingBrief(null);
                                }}
                              >
                                Set brief
                              </Btn>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingBrief(draft.key);
                              setBriefDraft(draft.customInstructions ?? "");
                            }}
                            className="text-[10.5px] text-faint-ink hover:text-bronze-ink"
                          >
                            {draft.customInstructions ? "Edit standing brief" : "+ Standing brief"}
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mt-4 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-faint-ink">
            <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-bronze" />
            Three to five seats is a board. More than eight and the deliberation turns into a panel.
          </p>
        </div>
      </div>
    </Modal>
  );
}
