"use client";

import { Mail } from "lucide-react";
import { useState } from "react";
import { AuthHeading, FormError, SubmitButton, TextField } from "@/components/auth-ui";
import { OtpStep } from "@/components/otp-step";
import { PasswordHint, PasswordInput } from "@/components/password-field";
import { formatClock } from "@/lib/shared/clock";
import { unmetPasswordRules } from "@/lib/shared/password-rules";

type Sent = { email: string; retryAfter?: number; expiresIn?: number; message?: string; codeAlreadySent?: boolean };

/** Two real steps: details, then the emailed code. */
function Steps({ current }: { current: 1 | 2 }) {
  const steps = ["Your details", "Confirm email"];
  return (
    <div aria-label={`Step ${current} of 2: ${steps[current - 1]}`} role="group" className="mb-7">
      <div className="flex gap-1.5" aria-hidden>
        {steps.map((_, i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i < current ? "bg-accent" : "bg-grid"}`} />
        ))}
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-ink-2">
        <span>Step {current} of 2</span>
        <span aria-hidden>·</span>
        <span>{steps[current - 1]}</span>
      </p>
    </div>
  );
}

export function RegisterForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);

  const rulesMet = unmetPasswordRules(password).length === 0;
  const matches = confirm.length > 0 && confirm === password;
  const canSubmit = email.includes("@") && rulesMet && matches && !pending;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<Sent> & { error?: string };
      if (res.ok) {
        // Reset first: if the person goes back to fix the address, the form must be usable again.
        setPending(false);
        setSent({ email: email.trim().toLowerCase(), retryAfter: body.retryAfter, expiresIn: body.expiresIn, message: body.message, codeAlreadySent: body.codeAlreadySent });
        return;
      }
      setError(
        res.status === 429 && body.retryAfter
          ? `${body.error ?? "Please wait."} You can try again in ${formatClock(body.retryAfter)}.`
          : (body.error ?? "Could not create the account."),
      );
    } catch {
      setError("Network error. Check your connection and try again.");
    }
    setPending(false);
  }

  if (sent) {
    return (
      <>
        <Steps current={2} />
        <OtpStep
          email={sent.email}
          initial={sent}
          next={null}
          // Normally the heading already says a code was sent; say more when one had just gone out.
          intro={sent.codeAlreadySent ? (sent.message ?? null) : null}
          onStartOver={() => setSent(null)}
          startOverLabel="Wrong email? Go back"
        />
      </>
    );
  }

  return (
    <>
      <Steps current={1} />
      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <AuthHeading title="Create your account" subtitle="Track food, workouts and weight against your own targets." />
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
          <div>
            <PasswordInput id="password" label="Password" value={password} onChange={setPassword} autoComplete="new-password" describedBy="password-rules" />
            <PasswordHint id="password-rules" password={password} />
          </div>
          <div>
            <PasswordInput id="confirm" label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" describedBy="confirm-status" />
            <p id="confirm-status" className={`mt-2 text-xs ${matches ? "text-good-ink" : confirm ? "text-critical-ink" : "text-ink-2"}`}>
              {matches ? "Passwords match." : confirm ? "Passwords do not match yet." : "Type it again to confirm."}
            </p>
          </div>
        </div>
        {error && <FormError>{error}</FormError>}
        <SubmitButton pending={pending} pendingLabel="Creating account…" disabled={!canSubmit}>
          Create account
        </SubmitButton>
        <p className="text-center text-xs text-ink-2">We&apos;ll email you a 6-digit code to confirm your address.</p>
      </form>
    </>
  );
}
