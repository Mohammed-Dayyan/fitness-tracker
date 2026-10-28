"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sparkles, Sun, type LucideIcon } from "lucide-react";
import { readPref, savePref, subscribeTheme, syncThemeColor, type ThemePref } from "@/lib/client/theme";

const OPTIONS: { pref: ThemePref; label: string; icon: LucideIcon }[] = [
  { pref: "light", label: "Light", icon: Sun },
  { pref: "dark", label: "Dark", icon: Moon },
  { pref: "aurora", label: "Aurora", icon: Sparkles },
  { pref: "system", label: "System", icon: Monitor },
];

/**
 * Light / Dark / Aurora / System. `compact` shows icons only (mobile top bar);
 * every button keeps an accessible name either way.
 */
export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  // The server renders "system"; the client switches to the stored value after hydration.
  const pref = useSyncExternalStore(subscribeTheme, readPref, (): ThemePref => "system");
  useEffect(() => {
    syncThemeColor();
  }, []);

  return (
    <div role="group" aria-label="Theme" className={compact ? "flex gap-0.5" : "grid grid-cols-2 gap-1"}>
      {OPTIONS.map(({ pref: value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => savePref(value)}
          aria-pressed={pref === value}
          aria-label={compact ? `${label} theme` : undefined}
          title={`${label} theme`}
          className={`flex items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-ink-2 hover:bg-surface-2 hover:text-ink aria-pressed:bg-[var(--nav-active-bg)] aria-pressed:text-ink aria-pressed:ring-1 aria-pressed:ring-accent ${compact ? "size-8" : "px-2 py-1.5"}`}
        >
          <Icon aria-hidden className="size-4" />
          {!compact && label}
        </button>
      ))}
    </div>
  );
}
