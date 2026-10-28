import type { ReactNode } from "react";
import { Dumbbell, Footprints, HeartPulse, Scale } from "lucide-react";
import { Ring } from "@/components/ring";
import { STATUS } from "@/components/dashboard";
import { StatusStrip } from "@/components/status-strip";
import type { DayView } from "@/lib/server/day";
import { fmtDateLong, fmtNumber } from "@/lib/shared/format";

// The hero is a gradient in every theme, so its rings use light colours chosen
// for that background rather than the chart palette (which is tuned for card surfaces).
const RING_CALORIES = "#ffffff";
const RING_PROTEIN = "#fde68a";

/**
 * The top of the Today page: the date (and whether it is today), the day's
 * status, rings for calories and protein, and quick figures for steps, weight
 * and training. Everything shown is derived from the same DayView as the cards
 * below it. `actions` holds the date navigation and the copy button.
 */
export function TodayHero({ view, date, kicker, actions }: { view: DayView; date: string; kicker: string; actions: ReactNode }) {
  const { summary, verdict } = view;
  const status = STATUS[verdict.status];
  const StatusIcon = status.icon;
  const logged = summary.food.entries > 0;
  const kcalTarget = (summary.targets?.calories as number | null | undefined) ?? null;
  const proteinTarget = (summary.targets?.protein_g as number | null | undefined) ?? null;
  const kcal = summary.food.totals.calories;
  const protein = summary.food.totals.protein_g;
  const kcalPartial = summary.food.missing.calories > 0;
  const proteinPartial = summary.food.missing.protein_g > 0;
  const training = summary.workouts.count + summary.cardio.count;

  const caption = (target: number | null, unit: string, partial: boolean) =>
    !logged ? "No food logged" : target == null ? `${unit} · target not set` : `of ${fmtNumber(target)} ${unit}${partial ? " · partial" : ""}`;

  return (
    <section className="hero rounded-3xl p-5 md:p-7" aria-label="Day summary">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--hero-ink-2)" }} data-testid="day-kicker">
            {kicker}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl" data-testid="day-heading" data-date={date}>
            {fmtDateLong(date)}
          </h1>
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm font-medium ring-1 ring-white/30">
            <StatusIcon aria-hidden className="size-4" />
            {status.label}
          </p>
          {verdict.targetsSet && verdict.status !== "no_data" && (
            <div className="mt-2">
              <StatusStrip checks={verdict.checks} onHero />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-around gap-6">
        <Ring
          label="Calories"
          value={logged ? kcal : null}
          target={kcalTarget}
          display={logged ? `${fmtNumber(kcal)}${kcalPartial ? "+" : ""}` : "–"}
          caption={caption(kcalTarget, "kcal", kcalPartial)}
          ariaValue={logged ? `${fmtNumber(kcal)}${kcalPartial ? " or more" : ""} kcal${kcalTarget ? ` of ${fmtNumber(kcalTarget)}` : ", no target set"}` : "no food logged"}
          color={RING_CALORIES}
        />
        <Ring
          label="Protein"
          value={logged ? protein : null}
          target={proteinTarget}
          display={logged ? `${fmtNumber(protein)}${proteinPartial ? "+" : ""}` : "–"}
          caption={caption(proteinTarget, "g", proteinPartial)}
          ariaValue={logged ? `${fmtNumber(protein)}${proteinPartial ? " or more" : ""} g${proteinTarget ? ` of ${fmtNumber(proteinTarget)}` : ", no target set"}` : "no food logged"}
          color={RING_PROTEIN}
        />
        <dl className="grid min-w-52 gap-2 text-sm">
          <HeroStat icon={Footprints} label="Steps" value={summary.steps == null ? "Not recorded" : fmtNumber(summary.steps)} />
          <HeroStat icon={Scale} label="Weight" value={summary.weight_kg == null ? "Not recorded" : `${fmtNumber(summary.weight_kg, 1)} kg`} />
          <HeroStat icon={training > 0 && summary.cardio.count > 0 && summary.workouts.count === 0 ? HeartPulse : Dumbbell} label="Training" value={training === 0 ? "None" : `${training} session${training > 1 ? "s" : ""}`} />
        </dl>
      </div>
    </section>
  );
}

function HeroStat({ icon: Icon, label, value }: { icon: typeof Footprints; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-white/12 px-3 py-2 ring-1 ring-white/20">
      <dt className="flex items-center gap-2" style={{ color: "var(--hero-ink-2)" }}>
        <Icon aria-hidden className="size-4" />
        {label}
      </dt>
      <dd className="tabular font-semibold">{value}</dd>
    </div>
  );
}
