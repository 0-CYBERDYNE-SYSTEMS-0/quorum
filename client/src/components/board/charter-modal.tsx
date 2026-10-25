import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Btn, Field, Modal, TextArea } from "@/components/design";
import { apiRequest } from "@/lib/queryClient";

const MAX = 2000;

export function CharterModal({
  open,
  onOpenChange,
  conversationId,
  charter,
  turnBudget,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: number | null;
  charter: string | null;
  turnBudget?: number | null;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState("");
  const [budget, setBudget] = useState<number>(25);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValue(charter ?? "");
    setBudget(turnBudget ?? 25);
    setError(null);
  }, [open, charter, turnBudget]);

  const save = async () => {
    if (!conversationId) return;
    setSaving(true);
    setError(null);
    try {
      await apiRequest("PUT", `/api/protected/conversations/${conversationId}`, {
        charter: value.trim() || null,
        turnBudget: budget,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/protected/conversations"] });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the charter.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Set the charter"
      description="The motion, the guardrails, and when the board should stop. Every director and the closing memo read this."
      footer={
        <>
          <span className="mr-auto text-[10.5px] text-faint-ink">{value.length}/{MAX}</span>
          <Btn variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Btn>
          <Btn variant="bronze" size="sm" onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save charter
          </Btn>
        </>
      }
    >
      <Field label="Decision on the table">
        <TextArea
          autoFocus
          value={value}
          maxLength={MAX}
          onChange={(event) => setValue(event.target.value)}
          placeholder={"Should we retire the self-serve tier and move upmarket in Q1?\n\nGuardrails: keep gross margin ≥ 70%, no new headcount before March, preserve the PLG funnel for the mid-market.\nStop when the board has a recommended path, the dissent, and the conditions that would change the answer."}
          className="min-h-[180px] font-display text-[16px] leading-relaxed"
        />
      </Field>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Autonomous turn budget" hint="0 = let it run">
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={40}
              step={1}
              value={budget}
              onChange={(event) => setBudget(Number(event.target.value))}
              className="h-1.5 flex-1 accent-[hsl(var(--bronze))]"
              aria-label="Turn budget"
            />
            <span className="w-12 text-right font-mono text-[12px] text-ink">{budget === 0 ? "∞" : budget}</span>
          </div>
        </Field>
        <p className="text-[11px] leading-relaxed text-faint-ink sm:pt-5">
          A charter keeps the board from drifting. Without one, directors default to the title of
          the session — and the memo is thinner for it.
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-md border border-oxblood/25 bg-oxblood-wash px-3 py-2 text-[12px] text-oxblood">
          {error}
        </p>
      )}
    </Modal>
  );
}
