"use client";

import { Toaster as Sonner } from "sonner";

/**
 * One toaster for the whole app shell. Colours come from our CSS variables, so
 * it follows Light, Dark and Ember without a theme prop. It sits at the top so
 * it never lands under the phone bottom nav. Toasts confirm a success; errors
 * stay inline next to the field so they can be read while fixing the input.
 */
export function Toaster() {
  return (
    <Sonner
      position="top-center"
      closeButton
      duration={5000}
      visibleToasts={3}
      style={
        {
          "--normal-bg": "var(--surface)",
          "--normal-text": "var(--ink)",
          "--normal-border": "var(--line)",
          "--success-bg": "var(--surface)",
          "--success-text": "var(--ink)",
          "--success-border": "var(--good)",
          "--border-radius": "12px",
          fontFamily: "inherit",
        } as React.CSSProperties
      }
    />
  );
}
