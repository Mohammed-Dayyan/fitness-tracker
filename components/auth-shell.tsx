import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";

// An example day, drawn the way the app draws a real one.
const SAMPLE = { calories: 1840, target: 2100 };
const MACROS = [
  { label: "Protein", value: 118, target: 140, color: "var(--s-protein)" },
  { label: "Carbs", value: 196, target: 230, color: "var(--s-carbs)" },
  { label: "Fat", value: 54, target: 70, color: "var(--s-fat)" },
  { label: "Fiber", value: 24, target: 30, color: "var(--s-fiber)" },
];

const R = 84;
const CIRC = 2 * Math.PI * R;
const OFFSET = CIRC * (1 - SAMPLE.calories / SAMPLE.target);

function SampleDay() {
  return (
    <div aria-hidden className="rounded-3xl bg-hero-ink/[0.07] p-6">
      <p className="text-[11px] font-medium tracking-[0.14em] text-hero-ink-2 uppercase">A sample day</p>
      <div className="mt-5 flex items-center gap-7">
        <div className="relative size-[168px] shrink-0">
          <svg viewBox="0 0 200 200" className="size-full -rotate-90" fill="none">
            <circle cx="100" cy="100" r={R} stroke="currentColor" strokeOpacity="0.14" strokeWidth="14" />
            <circle
              cx="100"
              cy="100"
              r={R}
              stroke="var(--accent)"
              strokeWidth="14"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={OFFSET}
              className="ring-sweep"
              style={{ "--ring-circ": CIRC } as React.CSSProperties}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="tabular font-display text-[2.25rem] leading-none font-semibold tracking-tight">
              {SAMPLE.calories.toLocaleString("en-US")}
            </p>
            <p className="mt-1.5 text-xs text-hero-ink-2">of {SAMPLE.target.toLocaleString("en-US")} kcal</p>
          </div>
        </div>
        <ul className="min-w-0 flex-1 space-y-3.5">
          {MACROS.map((m, i) => (
            <li key={m.label}>
              <div className="flex items-baseline justify-between text-[13px]">
                <span className="text-hero-ink-2">{m.label}</span>
                <span className="tabular font-medium">
                  {m.value}
                  <span className="text-hero-ink-2"> / {m.target} g</span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-hero-ink/[0.14]">
                <div
                  className="bar-grow h-full rounded-full"
                  style={{ width: `${(m.value / m.target) * 100}%`, background: m.color, animationDelay: `${0.7 + i * 0.12}s` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Frame for the sign-in and sign-up screens. On wide screens the left half is
 * the app's own dark panel with a sample day (the day ring from the logo, drawn
 * large); on phones it shrinks to the brand above the form.
 */
export function AuthShell({
  children,
  alternative,
}: {
  children: ReactNode;
  /** The link to the other screen, shown top right. */
  alternative: { prompt: string; label: string; href: string };
}) {
  return (
    <main className="grid min-h-dvh flex-1 lg:grid-cols-[5fr_6fr]">
      <aside className="hero hidden flex-col justify-between gap-10 p-12 lg:flex xl:p-16">
        <div className="flex items-center gap-2.5">
          <BrandMark className="size-8" />
          <span className="font-display text-lg font-semibold tracking-tight">Fitness Tracker</span>
        </div>
        <div className="max-w-md">
          <h2 className="font-display text-[2.75rem] leading-[1.05] font-semibold tracking-tight text-balance xl:text-5xl">
            See where the day stands before it&apos;s over.
          </h2>
          <p className="mt-5 max-w-sm text-base leading-relaxed text-hero-ink-2">
            Food, workouts, steps and weight in one place, measured against your own targets.
          </p>
        </div>
        <SampleDay />
      </aside>

      <div className="flex flex-col px-5 py-5 sm:px-10 sm:py-8">
        <header className="flex items-center justify-between gap-4 lg:justify-end">
          <div className="flex items-center gap-2 lg:hidden">
            <BrandMark className="size-7" />
            <span className="font-display text-base font-semibold tracking-tight text-ink">Fitness Tracker</span>
          </div>
          <p className="flex items-center gap-1.5 text-[13px] text-ink-2">
            <span className="hidden sm:inline">{alternative.prompt}</span>
            <Link href={alternative.href} className="font-semibold text-ink underline decoration-line decoration-2 underline-offset-4 hover:decoration-accent">
              {alternative.label}
            </Link>
          </p>
        </header>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[25rem]">{children}</div>
        </div>
      </div>
    </main>
  );
}
