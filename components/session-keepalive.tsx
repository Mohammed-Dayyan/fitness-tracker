"use client";

import { useEffect } from "react";

const MIN_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Renews the browser cookie's expiry for an active session (the server renews
 * its own record whenever a page is rendered) and sends the user to the sign-in
 * page if the session has ended. Runs on every full page load and whenever the
 * tab becomes visible again after 30+ minutes.
 */
export function SessionKeepAlive() {
  useEffect(() => {
    let last = 0;
    const ping = async () => {
      if (Date.now() - last < MIN_INTERVAL_MS) return;
      last = Date.now();
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        // Always finish with the body: an unread response keeps the connection
        // open (and the page "busy") until it is garbage collected.
        await res.arrayBuffer().catch(() => undefined);
        // A full load, so no signed-in page stays on screen from the router cache.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        if (res.status === 401) window.location.assign("/login");
      } catch {
        /* offline: try again next time */
      }
    };
    void ping();
    const onVisible = () => document.visibilityState === "visible" && void ping();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return null;
}
