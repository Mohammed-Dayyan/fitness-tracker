"use client";

import { useId, useState, type ReactNode } from "react";
import { Info } from "lucide-react";

/**
 * A small "what does this mean?" button. Works on tap and keyboard (not hover
 * only): the button toggles a short explanation, and Escape closes it.
 */
export function InfoHint({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="inline">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`What is ${label}?`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className="ml-1 inline-flex size-5 items-center justify-center rounded-full align-middle text-accent"
      >
        <Info aria-hidden className="size-3.5" />
      </button>
      {open && (
        <span id={id} role="note" className="mt-1 block max-w-xs rounded-lg bg-surface-2 p-2 text-xs font-normal text-ink">
          {children}
        </span>
      )}
    </span>
  );
}

export const RM_HINT = (
  <>
    <strong>1RM</strong> = one-rep max, the heaviest weight you could lift once. <strong>Est. 1RM</strong> is
    worked out from a set (weight × reps, Epley formula, sets of 1–12 reps), so you can compare sessions without
    testing a true max.
  </>
);
