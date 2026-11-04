"use client";

import { Mail } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthHeading, FormError, SubmitButton, TextField } from "@/components/auth-ui";
import { OtpStep } from "@/components/otp-step";
import { PasswordInput } from "@/components/password-field";
import { safeNextPath } from "@/lib/shared/redirect";

export function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ email: string; message: string; retryAfter?: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Live countdown while the sign-in limit is in force.
  useEffect(() => {
    if (lockedUntil <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lockedUntil]);
  const lockedFor = Math.max(0, Math.ceil((lockedUntil - now) / 1000));

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        // Full navigation so every server component re-reads the new session.
        window.location.assign(safeNextPath(params.get("next")));
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string; retryAfter?: number };
      if (body.code === "email_not_verified") {
        // Right password, address not confirmed yet: the server has sent a code.
        setConfirming({ email: email.trim().toLowerCase(), message: body.error ?? "Enter the code we emailed you.", retryAfter: body.retryAfter });
        return;
      }
      if (res.status === 429 && body.retryAfter) {
        setNow(Date.now());
        setLockedUntil(Date.now() + body.retryAfter * 1000);
        setError("Too many login attempts.");
      } else {
        setError(body.error ?? "Sign-in failed.");
      }
    } catch {
      setError("Network error. Check your connection and try again.");
    }
    setPending(false);
  }

  if (confirming) {
    return <OtpStep email={confirming.email} initial={confirming} next={params.get("next")} intro={confirming.message} />;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <AuthHeading title="Welcome back" subtitle="Sign in to see where today stands." />
      <div className="space-y-4">
        <TextField
          id="email"
          name="email"
          label="Email"
          icon={Mail}
          type="email"
          autoComplete="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordInput id="password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
      </div>
      {error && (
        <FormError>
          {error}
          {lockedFor > 0 && (
            <>
              {" "}
              Try again in <span className="tabular font-medium">{Math.floor(lockedFor / 60)}:{String(lockedFor % 60).padStart(2, "0")}</span>.
            </>
          )}
        </FormError>
      )}
      <SubmitButton pending={pending} pendingLabel="Signing in…" disabled={lockedFor > 0}>
        Sign in
      </SubmitButton>
    </form>
  );
}
