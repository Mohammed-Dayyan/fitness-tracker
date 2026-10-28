import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Clock, Dumbbell, HeartPulse, Medal, Repeat, Route, Trophy, Weight } from "lucide-react";
import { InfoHint, RM_HINT } from "@/components/info-hint";
import { Badge, Card, EmptyState, PageHeader, PageSkeleton, StatTile } from "@/components/ui";
import { requireOwner } from "@/lib/server/auth/current-owner";
import { prisma } from "@/lib/server/db";
import { buildCardioStats, cardioSessionsFor, fmtPace, getCardioRows, paceMinPerKm } from "@/lib/server/cardio";
import { buildExerciseHistory, buildExerciseStats, getSetRows, type PersonalRecords } from "@/lib/server/exercises";
import { exerciseKeyFromQuery } from "@/lib/shared/exercise";
import { fmtDateMedium, fmtDateShort, fmtNumber } from "@/lib/shared/format";

export const metadata: Metadata = { title: "Exercises" };

const first = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

/** Strength | Cardio switch: plain links, so it works without JavaScript and can be shared. */
function ModeSwitch({ mode }: { mode: "strength" | "cardio" }) {
  const item = (m: "strength" | "cardio", label: string, Icon: typeof Dumbbell) => (
    <Link
      href={m === "strength" ? "/exercises" : "/exercises?mode=cardio"}
      aria-current={mode === m ? "page" : undefined}
      className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium ${mode === m ? "btn-primary" : "text-ink-2 hover:text-ink"}`}
    >
      <Icon aria-hidden className="size-4" />
      {label}
    </Link>
  );
  return (
    <nav aria-label="Exercise type" className="card inline-flex gap-1 rounded-xl p-1">
      {item("strength", "Strength", Dumbbell)}
      {item("cardio", "Cardio", HeartPulse)}
    </nav>
  );
}

export default function ExercisesPage({ searchParams }: PageProps<"/exercises">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Exercises searchParams={searchParams} />
    </Suspense>
  );
}

function PrSummary({ prs }: { prs: PersonalRecords }) {
  return (
    <dl className="tabular grid grid-cols-3 gap-2 text-xs">
      <div>
        <dt className="text-ink-2">Max weight</dt>
        <dd className="text-sm font-semibold text-ink">{prs.max_weight ? `${fmtNumber(prs.max_weight.kg, 1)} kg` : "–"}</dd>
      </div>
      <div>
        <dt className="text-ink-2">Est. 1RM</dt>
        <dd className="text-sm font-semibold text-ink">{prs.best_e1rm ? `${fmtNumber(prs.best_e1rm.kg, 1)} kg` : "–"}</dd>
      </div>
      <div>
        <dt className="text-ink-2">Max reps</dt>
        <dd className="text-sm font-semibold text-ink">{prs.max_reps ? prs.max_reps.reps : "–"}</dd>
      </div>
    </dl>
  );
}

async function Exercises({ searchParams }: { searchParams: PageProps<"/exercises">["searchParams"] }) {
  const { ownerId } = await requireOwner();
  const params = await searchParams;
  const raw = first(params.exercise);
  if (first(params.mode) === "cardio") return <Cardio ownerId={ownerId} activity={first(params.activity)} />;
  // Links and shared URLs may carry the display name ("Bench Press"); records are
  // grouped by the normalised key, so look up by the same canonical form.
  const selected = typeof raw === "string" ? exerciseKeyFromQuery(raw) : null;

  if (selected !== null) {
    const rows = await getSetRows(ownerId, selected);
    if (rows.length === 0) {
      return (
        <div className="space-y-6">
          <BackLink />
          <Card>
            <EmptyState icon={Dumbbell} title="No sets found for this exercise" />
          </Card>
        </div>
      );
    }
    const [stats] = buildExerciseStats(rows);
    const sessions = buildExerciseHistory(rows);
    const { prs } = stats;
    return (
      <div className="space-y-6">
        <BackLink />
        <PageHeader title={stats.name} subtitle={`${stats.sessions} sessions · ${stats.sets} sets · last ${fmtDateMedium(stats.last_date)}`} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile label="Max weight" icon={Weight} value={prs.max_weight ? `${fmtNumber(prs.max_weight.kg, 1)} kg` : "–"} sub={prs.max_weight ? `${prs.max_weight.reps} reps · ${fmtDateShort(prs.max_weight.date)}` : "no loaded sets"} />
          <StatTile label={<>Best estimated 1RM<InfoHint label="estimated 1RM">{RM_HINT}</InfoHint></>} icon={Trophy} value={prs.best_e1rm ? `${fmtNumber(prs.best_e1rm.kg, 1)} kg` : "–"} sub={prs.best_e1rm ? `${fmtNumber(prs.best_e1rm.weight_kg, 1)} kg × ${prs.best_e1rm.reps} · ${fmtDateShort(prs.best_e1rm.date)}` : "needs a loaded set of 1–12 reps"} />
          <StatTile label="Max reps" icon={Repeat} value={prs.max_reps ? prs.max_reps.reps : "–"} sub={prs.max_reps ? `${prs.max_reps.weight_kg == null ? "bodyweight" : `${fmtNumber(prs.max_reps.weight_kg, 1)} kg`} · ${fmtDateShort(prs.max_reps.date)}` : undefined} />
        </div>
                <Card title="Sessions" icon={Dumbbell}>
          <ul className="divide-y divide-line">
            {sessions.map((s) => (
              <li key={s.workout_id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink">
                    <Link href={`/?date=${s.date}`} className="hover:underline">
                      {fmtDateMedium(s.date)}
                    </Link>
                    {s.workout_name && <span className="font-normal text-ink-2">{s.workout_name}</span>}
                    {s.new_pr && (
                      <Badge tone="good" icon={Medal}>
                        PR
                      </Badge>
                    )}
                  </p>
                  <p className="tabular text-xs text-ink-2">
                    {s.top_weight_kg != null && <>Top {fmtNumber(s.top_weight_kg, 1)} kg · </>}
                    {s.best_e1rm_kg != null && <>Est. 1RM {fmtNumber(s.best_e1rm_kg, 1)} kg · </>}
                    Volume {fmtNumber(s.volume_kg)} kg
                  </p>
                </div>
                <p className="tabular mt-1 text-sm text-ink-2">
                  {s.sets
                    .map((set) => `${set.reps ?? "?"}${set.weight_kg != null ? ` × ${fmtNumber(set.weight_kg, 1)} kg` : ""}${set.rpe != null ? ` @${set.rpe}` : ""}`)
                    .join(", ")}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    );
  }

  const [stats, workoutCount] = await Promise.all([
    getSetRows(ownerId).then(buildExerciseStats),
    // Strength workouts only; cardio sessions are a separate record type.
    prisma.workoutSession.count({ where: { ownerId } }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Exercises" subtitle="Personal records and history, grouped by exercise name" />
      <ModeSwitch mode="strength" />
      <p className="text-xs text-ink-2">
        Est. 1RM<InfoHint label="Est. 1RM">{RM_HINT}</InfoHint> is shown on every card below.
      </p>
      {stats.length === 0 ? (
        <Card>
          {workoutCount > 0 ? (
            <EmptyState icon={Dumbbell} title="Workouts logged, but no exercise sets recorded yet">
              {workoutCount} workout{workoutCount === 1 ? "" : "s"} recorded without sets. Personal records need sets with an
              exercise name, reps and (for loaded lifts) weight. Import them on the{" "}
              <Link href="/data" className="font-medium underline">Data</Link> page, nested under the workout or as{" "}
              <code className="text-xs">exercise_sets</code> with its <code className="text-xs">workout_id</code>.
            </EmptyState>
          ) : (
            <EmptyState icon={Dumbbell} title="No workouts or exercise sets yet">
              Import workouts with their sets on the <Link href="/data" className="font-medium underline">Data</Link> page.
            </EmptyState>
          )}
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stats.map((s) => (
            <li key={s.key}>
              <Link href={`/exercises?exercise=${encodeURIComponent(s.key)}`} className="block card rounded-2xl p-4 hover:bg-surface-2">
                <p className="font-semibold text-ink">{s.name}</p>
                <p className="mb-3 text-xs text-ink-2">
                  {s.sessions} sessions · last {fmtDateShort(s.last_date)}
                </p>
                <PrSummary prs={s.prs} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function Cardio({ ownerId, activity }: { ownerId: string; activity: string | undefined }) {
  const rows = await getCardioRows(ownerId);
  const key = activity ? exerciseKeyFromQuery(activity) : null;

  if (key !== null) {
    const sessions = cardioSessionsFor(rows, key);
    const [stats] = buildCardioStats(sessions);
    if (!stats) {
      return (
        <div className="space-y-6">
          <BackLink cardio />
          <Card>
            <EmptyState icon={HeartPulse} title="No cardio sessions found for this activity" />
          </Card>
        </div>
      );
    }
    return (
      <div className="space-y-6">
        <BackLink cardio />
        <PageHeader title={stats.name} subtitle={`${stats.sessions} sessions · last ${fmtDateMedium(stats.last_date)}`} />
        <CardioTiles s={stats} />
        <Card title="Sessions" icon={HeartPulse}>
          <ul className="divide-y divide-line">
            {sessions.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/?date=${r.date}`} className="text-sm font-medium text-ink hover:underline">
                    {fmtDateMedium(r.date)}
                  </Link>
                  <p className="tabular text-xs text-ink-2">
                    {[
                      r.distance_km != null && `${fmtNumber(r.distance_km, 2)} km`,
                      r.duration_min != null && `${fmtNumber(r.duration_min)} min`,
                      paceMinPerKm(r.duration_min, r.distance_km) != null && fmtPace(paceMinPerKm(r.duration_min, r.distance_km)),
                      r.avg_heart_rate != null && `${r.avg_heart_rate} bpm`,
                      r.estimated_calories != null && `${fmtNumber(r.estimated_calories)} kcal (est.)`,
                    ].filter(Boolean).join(" · ") || "No details recorded"}
                  </p>
                </div>
                {r.notes && <p className="mt-1 text-sm text-ink-2">{r.notes}</p>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    );
  }

  const stats = buildCardioStats(rows);
  return (
    <div className="space-y-6">
      <PageHeader title="Exercises" subtitle="Cardio totals and history, grouped by activity name" />
      <ModeSwitch mode="cardio" />
      {stats.length === 0 ? (
        <Card>
          <EmptyState icon={HeartPulse} title="No cardio sessions yet">
            Import cardio sessions (running, cycling, walking…) on the <Link href="/data" className="font-medium underline">Data</Link> page.
          </EmptyState>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stats.map((s) => (
            <li key={s.key}>
              <Link href={`/exercises?mode=cardio&activity=${encodeURIComponent(s.key)}`} className="block card rounded-2xl p-4 hover:bg-surface-2">
                <p className="font-semibold text-ink">{s.name}</p>
                <p className="mb-3 text-xs text-ink-2">
                  {s.sessions} sessions · last {fmtDateShort(s.last_date)}
                </p>
                <dl className="tabular grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-ink-2">Distance</dt>
                    <dd className="text-sm font-semibold text-ink">{s.total_km > 0 ? `${fmtNumber(s.total_km, 1)} km` : "–"}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-2">Time</dt>
                    <dd className="text-sm font-semibold text-ink">{s.total_min > 0 ? `${fmtNumber(s.total_min)} min` : "–"}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-2">Best pace</dt>
                    <dd className="text-sm font-semibold text-ink">{fmtPace(s.best_pace_min_per_km)}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CardioTiles({ s }: { s: ReturnType<typeof buildCardioStats>[number] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatTile label="Total distance" icon={Route} value={s.total_km > 0 ? `${fmtNumber(s.total_km, 1)} km` : "–"} sub={s.longest_km != null ? `longest ${fmtNumber(s.longest_km, 2)} km` : "no distance recorded"} />
      <StatTile label="Total time" icon={Clock} value={s.total_min > 0 ? `${fmtNumber(s.total_min)} min` : "–"} sub={s.longest_min != null ? `longest ${fmtNumber(s.longest_min)} min` : "no duration recorded"} />
      <StatTile label="Best pace" icon={Trophy} value={fmtPace(s.best_pace_min_per_km)} sub={s.best_pace_min_per_km == null ? "needs both distance and time" : undefined} />
    </div>
  );
}

function BackLink({ cardio = false }: { cardio?: boolean }) {
  return (
    <Link href={cardio ? "/exercises?mode=cardio" : "/exercises"} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
      <ArrowLeft aria-hidden className="size-4" />
      {cardio ? "All cardio" : "All exercises"}
    </Link>
  );
}
