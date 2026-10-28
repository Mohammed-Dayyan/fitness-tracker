"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-renders the page from the server when the owner's local day changes, so
 * a tab left open overnight (or restored from the browser's back/forward
 * cache, or resumed on a phone) never keeps showing yesterday as "Today".
 *
 * The server sends the time remaining until its own local midnight; this
 * counts that duration from mount, so a wrong device clock or timezone
 * can't trigger a refresh at the wrong moment.
 */
export function DayWatcher({ today, msUntilNextDay }: { today: string; msUntilNextDay: number }) {
  const router = useRouter();
  useEffect(() => {
    const deadline = Date.now() + msUntilNextDay;
    let refreshed = false;
    const check = () => {
      if (refreshed || Date.now() < deadline) return;
      refreshed = true;
      router.refresh();
    };
    // Timers are throttled in background tabs; the event checks cover that.
    const timer = window.setTimeout(check, msUntilNextDay + 1000);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
    };
  }, [today, msUntilNextDay, router]);
  return null;
}
