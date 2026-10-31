"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui";
import { fmtDateMedium, fmtNumber } from "@/lib/shared/format";

type FieldErrors = Record<string, string>;

const input =
  "block w-full min-w-0 rounded-[10px] border border-line bg-surface px-3 py-2 text-sm text-ink aria-[invalid=true]:border-critical";

/**
 * "Log today" for the day being viewed: steps, weight or both, no ChatGPT
 * needed. A blank field is ignored (it never clears what is stored). Render it
 * with key={date} so navigating to another day never carries typed values or
 * errors over to it. Success is a toast; errors stay next to the field.
 */
export function DailyQuickLog({
  date,
  today,
  steps: currentSteps,
  weightKg,
  embedded = false,
}: {
  date: string;
  today: string;
  steps: number | null;
  weightKg: number | null;
  embedded?: boolean;
}) {
  const router = useRouter();
  const [steps, setSteps] = useState("");
  const [weight, setWeight] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const future = date > today;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setFailure(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ section: "daily", date, steps, weight_kg: weight }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string; fieldErrors?: FieldErrors } | null;
      if (res.ok && data?.ok) {
        setSteps("");
        setWeight("");
        toast.success(data.message ?? "Saved.");
        router.refresh();
      } else {
        setErrors(data?.fieldErrors ?? {});
        setFailure(data?.error ?? "Could not save. Nothing was changed.");
      }
    } catch {
      setFailure("Network error. Nothing was saved.");
    } finally {
      setSaving(false);
    }
  }

  const title = date === today ? "Log today" : `Log ${fmtDateMedium(date)}`;
  const body = future ? (
    <p className="text-sm text-ink-2">Nothing can be logged for a day that hasn&apos;t happened yet.</p>
  ) : (
    <form onSubmit={onSubmit} noValidate className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="quick-steps" className="block text-sm font-medium text-ink">
            Steps
          </label>
          <input
            id="quick-steps"
            inputMode="numeric"
            autoComplete="off"
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            placeholder={currentSteps != null ? `Now ${fmtNumber(currentSteps)}` : "e.g. 8500"}
            aria-invalid={errors.steps ? true : undefined}
            aria-describedby={errors.steps ? "quick-steps-error" : undefined}
            className={`mt-1 ${input}`}
          />
          {errors.steps && (
            <p id="quick-steps-error" className="mt-1 text-xs font-medium text-critical-ink">
              {errors.steps}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="quick-weight" className="block text-sm font-medium text-ink">
            Weight (kg)
          </label>
          <input
            id="quick-weight"
            inputMode="decimal"
            autoComplete="off"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder={weightKg != null ? `Now ${fmtNumber(weightKg, 1)}` : "e.g. 79.5"}
            aria-invalid={errors.weight_kg ? true : undefined}
            aria-describedby={errors.weight_kg ? "quick-weight-error" : undefined}
            className={`mt-1 ${input}`}
          />
          {errors.weight_kg && (
            <p id="quick-weight-error" className="mt-1 text-xs font-medium text-critical-ink">
              {errors.weight_kg}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-[10px] btn-primary px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60">
          {saving && <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />}
          Save
        </button>
        <p className="text-xs text-ink-2">Fill in one or both. A blank field keeps what is saved.</p>
      </div>
      {failure && (
        <p role="alert" className="flex items-center gap-2 text-sm text-critical-ink">
          <TriangleAlert aria-hidden className="size-4" />
          {failure}
        </p>
      )}
    </form>
  );
  if (embedded) {
    return (
      <div className="border-t border-line pt-4">
        <h3 className="mb-3 text-[13px] font-medium text-ink-2">{title}</h3>
        {body}
      </div>
    );
  }
  return <Card title={title}>{body}</Card>;
}
