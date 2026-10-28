import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { fmtNumber } from "@/lib/shared/format";

/** A flat panel with a quiet title. */
export function Card({
  title,
  action,
  children,
  className = "",
  id,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`card rounded-2xl p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h2 className="text-[13px] font-medium text-ink-2">{title}</h2>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export type Tone = "neutral" | "good" | "warning" | "critical" | "info";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface text-ink-2 ring-1 ring-line ring-inset",
  good: "bg-good/12 text-good-ink",
  warning: "bg-warning/18 text-warning-ink",
  critical: "bg-critical/12 text-critical-ink",
  info: "bg-[color-mix(in_oklab,var(--accent)_18%,transparent)] text-ink",
};

export function Badge({ tone = "neutral", icon: Icon, children }: { tone?: Tone; icon?: LucideIcon; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}>
      {Icon && <Icon aria-hidden className="size-3" />}
      {children}
    </span>
  );
}

/**
 * Progress against a target. The track is a light step of the series colour,
 * the fill the series colour; overshoot is shown as a marker past 100%.
 * The numbers are always printed beside it (colour is never the only cue).
 */
export function Meter({
  label,
  value,
  target,
  unit,
  color,
  note,
  overIsBad = true,
  emptyLabel = "Not recorded",
}: {
  label: string;
  value: number | null;
  target: number | null;
  unit: string;
  color: string;
  note?: ReactNode;
  /** Mark overshoot as a concern (calories, carbs, fat); not for protein, fiber or steps. */
  overIsBad?: boolean;
  /** Shown instead of a value when there is none ("No food logged" for nutrition, "Not recorded" for steps). */
  emptyLabel?: string;
}) {
  const hasTarget = target != null && target > 0;
  const pct = value != null && hasTarget ? value / target : null;
  const width = pct == null ? 0 : Math.min(pct, 1) * 100;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
        <span className="flex items-center gap-2 font-medium text-ink">
          <span aria-hidden className="size-2.5 rounded-full" style={{ background: color }} />
          {label}
        </span>
        <span className="tabular text-ink-2">
          {value == null ? (
            <span className="text-muted">{emptyLabel}</span>
          ) : (
            <span className="font-semibold text-ink">{fmtNumber(value)}</span>
          )}
          {hasTarget ? ` / ${fmtNumber(target)}` : ""}
          {value != null && unit ? ` ${unit}` : ""}
          {pct != null && <span className="ml-1.5 text-muted">{Math.round(pct * 100)}%</span>}
        </span>
      </div>
      {hasTarget ? (
        <div
          role="meter"
          aria-label={`${label}: ${value == null ? emptyLabel.toLowerCase() : fmtNumber(value)} of ${fmtNumber(target)} ${unit}`.trim()}
          aria-valuemin={0}
          aria-valuemax={target}
          aria-valuenow={value ?? 0}
          className="relative h-2 overflow-hidden rounded-full"
          style={{ background: `color-mix(in oklab, ${color} 16%, var(--surface))` }}
        >
          <div className="h-full rounded-full" style={{ width: `${width}%`, background: color }} />
          {overIsBad && pct != null && pct > 1 && (
            <div aria-hidden className="absolute inset-y-0 right-0 w-1 bg-critical" title="Over target" />
          )}
        </div>
      ) : (
        // No bar without a target: an empty bar would read as a failure.
        <p className="text-xs text-muted">Target not set</p>
      )}
      {note && <p className="mt-1 text-xs text-ink-2">{note}</p>}
    </div>
  );
}

/**
 * One strip of figures split by hairlines (gap-px over a line-coloured ground),
 * so any number of cells wraps cleanly and the strip closes on both edges.
 * Pass the column classes ("grid-cols-2 lg:grid-cols-4"); fill whole rows.
 */
export function KpiStrip({ children, className = "grid-cols-2 lg:grid-cols-4" }: { children: ReactNode; className?: string }) {
  return <div className={`grid gap-px overflow-hidden rounded-2xl border border-[var(--card-border)] bg-[var(--line)] ${className}`}>{children}</div>;
}

/** A figure, not a widget: label over a large number, no icon chip. Lives inside a KpiStrip. */
export function StatTile({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="bg-[var(--card-bg)] p-4">
      <p className="text-xs font-medium text-ink-2">{label}</p>
      <p className="tabular mt-1 font-display text-3xl font-semibold tracking-tight text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-2">{sub}</p>}
    </div>
  );
}

/** Pill-in-a-track control made of links (server-rendered, shareable). Mark the current item with aria-current. */
export function Segmented({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <nav aria-label={label} className={`inline-flex flex-wrap gap-1 rounded-[10px] bg-surface-2 p-1 ${className}`}>
      {children}
    </nav>
  );
}
export const SEG_ITEM =
  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-ink-2 hover:text-ink aria-[current=page]:bg-surface aria-[current=page]:text-ink aria-[current=true]:bg-surface aria-[current=true]:text-ink";

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line px-4 py-8 text-center">
      <Icon aria-hidden className="size-6 text-muted" />
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="max-w-sm text-sm text-ink-2">{children}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`rounded-xl bg-surface-2 motion-safe:animate-pulse ${className}`} />;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-56" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}
