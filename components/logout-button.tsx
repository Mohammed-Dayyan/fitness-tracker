"use client";

import { LogOut } from "lucide-react";

export function LogoutButton({ compact = false }: { compact?: boolean }) {
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    // A full load, not router.push: discards the client router cache so no
    // authenticated page can be shown again from memory.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }
  return (
    <button
      onClick={logout}
      aria-label="Sign out"
      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
    >
      <LogOut aria-hidden className="size-4" />
      {!compact && "Sign out"}
    </button>
  );
}
