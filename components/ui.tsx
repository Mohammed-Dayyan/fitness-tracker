import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { fmtNumber } from "@/lib/shared/format";

export function Card({
  title,
  icon: Icon,
  action,
  children,
  className = "",
  id,
}: {
  title?: string;
  icon?: LucideIcon;
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
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              {Icon && <Icon aria-hidden className="size-4 text-accent" />}
              {title}
            </h2>
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

export function StatTile({ label, value, sub, icon: Icon }: { label: ReactNode; value: ReactNode; sub?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="card rounded-2xl p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
        {Icon && <Icon aria-hidden className="size-3.5" />}
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-2">{sub}</p>}
    </div>
  );
}

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
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
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
