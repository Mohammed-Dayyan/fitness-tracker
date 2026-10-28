import type { ReactNode } from "react";

/**
 * A circular progress indicator for "value of target". Honest about missing
 * data: no target draws only the track, no value shows a dash, and going over
 * target fills the ring and says so in the caption (the ring itself never
 * pretends to be more than 100%). The number and caption carry the meaning;
 * colour is only decoration.
 */
export function Ring({
  label,
  value,
  target,
  display,
  caption,
  ariaValue,
  color,
  track = "rgba(255,255,255,0.2)",
  size = 124,
  children,
}: {
  label: string;
  value: number | null;
  target: number | null;
  /** The big text in the middle, e.g. "1,822". */
  display: string;
  /** Small line under the label, e.g. "of 2,000 kcal". */
  caption: ReactNode;
  /** Spoken description, e.g. "1,822 of 2,000 kcal". */
  ariaValue: string;
  color: string;
  track?: string;
  size?: number;
  children?: ReactNode;
}) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const hasTarget = target != null && target > 0;
  const ratio = value != null && hasTarget ? value / target : null;
  const filled = ratio == null ? 0 : Math.min(ratio, 1);

  return (
    <div className="flex flex-col items-center text-center">
      <div
        role="img"
        aria-label={`${label}: ${ariaValue}${ratio != null ? ` (${Math.round(ratio * 100)}%)` : ""}`}
        className="relative"
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
          {filled > 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${filled * c} ${c}`}
              // --ring-glow is a soft glow in Aurora and "none" elsewhere.
              style={{ color, filter: "var(--ring-glow, none)" }}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular text-2xl leading-none font-semibold">{display}</span>
          {children}
        </div>
      </div>
      <p className="mt-2 text-sm font-semibold">{label}</p>
      <p className="text-xs opacity-80">{caption}</p>
    </div>
  );
}
