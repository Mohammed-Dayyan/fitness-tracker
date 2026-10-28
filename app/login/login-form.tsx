"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { safeNextPath } from "@/lib/shared/redirect";

export function LoginForm() {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const password = new FormData(event.currentTarget).get("password");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // Full navigation so every server component re-reads the new session.
        window.location.assign(safeNextPath(params.get("next")));
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Sign-in failed.");
    } catch {
      setError("Network error. Check your connection and try again.");
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-ink">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          className="mt-1 block w-full rounded-lg border border-line bg-surface px-3 py-2 text-ink outline-none focus:ring-2 focus:ring-[color-mix(in_oklab,var(--s-calories)_35%,transparent)]"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-critical-ink">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg btn-primary px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
