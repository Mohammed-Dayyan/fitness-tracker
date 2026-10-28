"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Footprints, Loader2, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui";

type Status = { kind: "idle" } | { kind: "saving" } | { kind: "ok"; message: string } | { kind: "error"; message: string };

/**
 * Steps-only quick log for the day being viewed (no ChatGPT needed). Render it
 * with key={date} so navigating to another day never carries a typed value or
 * a message over to it.
 */
export function StepsQuickLog({ date, today, current }: { date: string; today: string; current: number | null }) {
  const router = useRouter();
  const [steps, setSteps] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const future = date > today;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus({ kind: "saving" });
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ section: "steps", date, steps }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; error?: string; fieldErrors?: Record<string, string> } | null;
      if (res.ok && data?.ok) {
        setSteps("");
        setStatus({ kind: "ok", message: data.message ?? "Saved." });
        router.refresh();
      } else {
        setError(data?.fieldErrors?.steps ?? data?.fieldErrors?.date ?? null);
        setStatus({ kind: "error", message: data?.error ?? "Could not save. Nothing was changed." });
      }
    } catch {
      setStatus({ kind: "error", message: "Network error. Nothing was saved." });
    }
  }

  return (
    <Card title="Log steps" icon={Footprints}>
      {future ? (
        <p className="text-sm text-ink-2">Steps can&apos;t be logged for a day that hasn&apos;t happened yet.</p>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-3">
          <div>
            <label htmlFor="quick-steps" className="block text-sm font-medium text-ink">
              Steps for {date === today ? "today" : date}
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="quick-steps"
                inputMode="numeric"
                autoComplete="off"
                value={steps}
                onChange={(e) => setSteps(e.target.value)}
                placeholder={current != null ? `Now ${current.toLocaleString("en-US")}` : "e.g. 8500"}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "quick-steps-error" : undefined}
                className="block w-full min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink aria-[invalid=true]:border-critical"
              />
              <button type="submit" disabled={status.kind === "saving"} className="inline-flex items-center gap-2 rounded-lg btn-primary px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60">
                {status.kind === "saving" && <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />}
                Save
              </button>
            </div>
            {error && (
              <p id="quick-steps-error" className="mt-1 text-xs font-medium text-critical-ink">
                {error}
              </p>
            )}
            <p className="mt-1 text-xs text-ink-2">Saving replaces this day&apos;s step count. Weight and notes are kept.</p>
          </div>
          {status.kind === "ok" && (
            <p role="status" className="flex items-center gap-2 text-sm text-good-ink">
              <CheckCircle2 aria-hidden className="size-4" />
              {status.message}
            </p>
          )}
          {status.kind === "error" && (
            <p role="alert" className="flex items-center gap-2 text-sm text-critical-ink">
              <TriangleAlert aria-hidden className="size-4" />
              {status.message}
            </p>
          )}
        </form>
      )}
    </Card>
  );
}
