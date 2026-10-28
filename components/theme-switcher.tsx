"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Flame, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { readPref, savePref, subscribeTheme, syncThemeColor, type ThemePref } from "@/lib/client/theme";

const OPTIONS: { pref: ThemePref; label: string; icon: LucideIcon }[] = [
  { pref: "light", label: "Light", icon: Sun },
  { pref: "dark", label: "Dark", icon: Moon },
  { pref: "ember", label: "Ember", icon: Flame },
  { pref: "system", label: "System", icon: Monitor },
];

/**
 * Light / Dark / Ember / System as one row of icon buttons. Every button has an
 * accessible name; the sidebar variant also prints the current choice.
 */
export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  // The server renders "system"; the client switches to the stored value after hydration.
  const pref = useSyncExternalStore(subscribeTheme, readPref, (): ThemePref => "system");
  useEffect(() => {
    syncThemeColor();
  }, []);

  return (
    <div>
      <div role="group" aria-label="Theme" className="flex gap-0.5 rounded-[10px] bg-surface-2 p-0.5">
        {OPTIONS.map(({ pref: value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => savePref(value)}
            aria-pressed={pref === value}
            aria-label={`${label} theme`}
            title={`${label} theme`}
            className={`flex flex-1 items-center justify-center rounded-lg text-ink-2 hover:text-ink aria-pressed:bg-surface aria-pressed:text-accent-ink ${compact ? "size-8" : "h-8"}`}
          >
            <Icon aria-hidden className="size-4" />
          </button>
        ))}
      </div>
      {!compact && (
        <p className="mt-1.5 px-1 text-xs text-muted">{OPTIONS.find((o) => o.pref === pref)?.label} theme</p>
      )}
    </div>
  );
}
