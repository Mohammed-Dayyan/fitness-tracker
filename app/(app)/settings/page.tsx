import { Suspense } from "react";
import type { Metadata } from "next";

import { DayWatcher } from "@/components/day-watcher";
import { ProfileForm, TargetsForm, WeighInForm } from "@/components/settings-forms";
import { Card, PageHeader, PageSkeleton } from "@/components/ui";
import { requireOwner } from "@/lib/server/auth/current-owner";
import { getDayContext } from "@/lib/server/day";
import { targetsInEffect } from "@/lib/server/repo";
import { getSettingsData } from "@/lib/server/settings";
import { fmtDateMedium, fmtNumber } from "@/lib/shared/format";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Your profile, and the daily targets each day is measured against." />
      <Suspense fallback={<PageSkeleton />}>
        <SettingsContent />
      </Suspense>
    </div>
  );
}

const COLUMNS = [
  ["calories", "Calories"],
  ["protein_g", "Protein"],
  ["carbs_g", "Carbs"],
  ["fat_g", "Fat"],
  ["fiber_g", "Fiber"],
  ["steps", "Steps"],
  ["goal_weight_kg", "Goal kg"],
] as const;

async function SettingsContent() {
  const { ownerId } = await requireOwner();
  const ctx = await getDayContext(ownerId);
  const { profile, targets, latestWeight } = await getSettingsData(ownerId);
  const current = targetsInEffect(targets, ctx.today);

  return (
    <div className="max-w-3xl space-y-4">
      <DayWatcher today={ctx.today} msUntilNextDay={ctx.msUntilNextDay} />
      <Card title="Profile" id="profile">
        <ProfileForm profile={profile} today={ctx.today} />
      </Card>

      <Card title="Body weight" id="weight">
        <p className="mb-4 text-sm text-ink-2">A weight is a dated measurement, separate from your profile. Pick the day and record it.</p>
        <WeighInForm latestWeight={latestWeight} today={ctx.today} />
      </Card>

      <Card title="Daily targets" id="targets" className="scroll-mt-6">
        <p className="mb-4 text-sm text-ink-2">
          {current
            ? `Current targets apply from ${fmtDateMedium(current.effective_from as string)}.`
            : "No targets yet. Enter the ones you know; anything left blank stays unset."}
        </p>
        <TargetsForm versions={targets} profile={profile} latestWeight={latestWeight} today={ctx.today} />
      </Card>

      {targets.length > 0 && (
        <Card title="Target history">
          <div className="-mx-5 overflow-x-auto">
            <table className="tabular w-full min-w-[36rem] text-left text-sm">
              <caption className="sr-only">Target versions, newest first</caption>
              <thead className="text-xs text-ink-2">
                <tr className="border-b border-line">
                  <th scope="col" className="px-5 py-2 font-medium">From</th>
                  {COLUMNS.map(([, label]) => (
                    <th key={label} scope="col" className="px-2 py-2 text-right font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...targets].reverse().map((t) => (
                  <tr key={t.id as string} className="border-b border-line last:border-0">
                    <th scope="row" className="px-5 py-2 font-medium text-ink">
                      {fmtDateMedium(t.effective_from as string)}
                      {t === current && <span className="ml-2 text-xs font-normal text-ink-2">(current)</span>}
                    </th>
                    {COLUMNS.map(([key]) => (
                      <td key={key} className="px-2 py-2 text-right text-ink">
                        {t[key] == null ? "–" : fmtNumber(t[key] as number, 1)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
