import { Suspense } from "react";
import type { Metadata } from "next";

import { CopyButton } from "@/components/client-actions";
import { DayWatcher } from "@/components/day-watcher";
import { ExportPanel } from "@/components/export-panel";
import { ImportPanel } from "@/components/import-panel";
import { Card, PageHeader, PageSkeleton } from "@/components/ui";
import { requireOwner } from "@/lib/server/auth/current-owner";
import { getDayContext } from "@/lib/server/day";
import { addDays } from "@/lib/shared/dates";

export const metadata: Metadata = { title: "Data" };

export default function DataPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Data" subtitle="Import JSON from ChatGPT, give ChatGPT context, and export your records." />
      <Suspense fallback={<PageSkeleton />}>
        <DataPanels />
      </Suspense>
    </div>
  );
}

const STEPS = [
  ["1", "Paste the JSON or choose a file"],
  ["2", "Validate & preview: nothing is saved yet"],
  ["3", "Confirm to save the listed changes"],
] as const;

async function DataPanels() {
  const { ownerId } = await requireOwner();
  const ctx = await getDayContext(ownerId);
  return (
    <div className="space-y-4">
      <DayWatcher today={ctx.today} msUntilNextDay={ctx.msUntilNextDay} />
      <Card title="Import" className="min-w-0">
        <ol className="mb-4 grid gap-2 sm:grid-cols-3">
          {STEPS.map(([n, text]) => (
            <li key={n} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink">
              <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full btn-primary text-xs font-semibold">
                {n}
              </span>
              {text}
            </li>
          ))}
        </ol>
        <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-ink-2">
          <li>To correct a record, the JSON must use that record&apos;s existing ID. A new or guessed ID creates a duplicate.</li>
          <li>Records left out of the JSON are never deleted. Deleting needs an explicit &quot;delete&quot; list of IDs.</li>
        </ul>
        <ImportPanel today={ctx.today} />
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-5">
        <Card title="ChatGPT context" className="min-w-0 lg:col-span-2">
          <p className="mb-3 text-sm text-ink-2">
            Paste this as the first message of a new ChatGPT conversation. It has the import rules, your targets and recent
            progress, but not your full history; ChatGPT is told to ask for an export when it needs record IDs or past details.
          </p>
          <CopyButton url="/api/export/context" label="Copy context" variant="primary" />
        </Card>
        <Card title="Export records" className="min-w-0 lg:col-span-3">
          <ExportPanel today={ctx.today} defaultFrom={addDays(ctx.today, -29)} />
        </Card>
      </div>
    </div>
  );
}
