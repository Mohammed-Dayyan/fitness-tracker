"use client";

import { Clock, MailCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AuthHeading, FormError, FormNotice, SubmitButton } from "@/components/auth-ui";
import { formatClock as clock } from "@/lib/shared/clock";
import { safeNextPath } from "@/lib/shared/redirect";

const CELLS = 6;

type Timing = { retryAfter?: number; expiresIn?: number };

/**
 * Asks for the 6-digit code that was emailed, with the two clocks that matter:
 * how long until a new code may be requested (60 s, or the longer wait after
 * too many requests) and how long the current code stays valid (10 min).
 * A correct code confirms the address and signs the person in.
 *
 * One real input (so paste and the phone's "code from email" suggestion work)
 * sits invisibly over six cells that mirror what was typed.
 */
export function OtpStep({
  email,
  initial,
  next,
  intro,
  onStartOver,
  startOverLabel,
}: {
  email: string;
  initial: Timing;
  next: string | null;
  /** A message from the server to show above the code (e.g. why we are asking). */
  intro: string | null;
  /** Lets the person go back and fix a mistyped address. */
  onStartOver: () => void;
  startOverLabel: string;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(intro);
  const [pending, setPending] = useState(false);
  const [focused, setFocused] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [resendAt, setResendAt] = useState(() => Date.now() + (initial.retryAfter ?? 60) * 1000);
  const [expiresAt, setExpiresAt] = useState(() => Date.now() + (initial.expiresIn ?? 600) * 1000);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => inputRef.current?.focus(), []);

  const resendIn = Math.max(0, (resendAt - now) / 1000);
  const expiresIn = Math.max(0, (expiresAt - now) / 1000);

  async function submit(value: string) {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code: value }),
      });
      if (res.ok) {
        // Full navigation so every server component re-reads the new sign-in.
        window.location.assign(safeNextPath(next));
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; retryAfter?: number };
      setError(
        res.status === 429 && body.retryAfter
          ? `Too many attempts. Try again in ${clock(body.retryAfter)}.`
          : (body.error ?? "Could not check the code."),
      );
      setCode("");
    } catch {
      setError("Network error. Check your connection and try again.");
    }
    setPending(false);
    inputRef.current?.focus();
  }

  async function resend() {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = (await res.json().catch(() => ({}))) as Timing & { error?: string };
      const t = Date.now();
      setNow(t); // keep the on-screen clock in step with the new deadlines
      if (res.ok) {
        setResendAt(t + (body.retryAfter ?? 60) * 1000);
        setExpiresAt(t + (body.expiresIn ?? 600) * 1000);
        setNotice("A new code is on its way. The old one no longer works.");
        setCode("");
      } else if (res.status === 429 && body.retryAfter) {
        setResendAt(t + body.retryAfter * 1000);
        setError(
          body.retryAfter > 60
            ? "You have asked for too many codes. You can request another later."
            : "Please wait a moment before asking for another code.",
        );
      } else {
        setError(body.error ?? "Could not send a new code.");
      }
    } catch {
      setError("Network error. Check your connection and try again.");
    }
    setPending(false);
    inputRef.current?.focus();
  }

  const activeCell = Math.min(code.length, CELLS - 1);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === CELLS && !pending) void submit(code);
      }}
      className="space-y-6"
    >
      <AuthHeading
        icon={MailCheck}
        title="Check your email"
        subtitle={
          <>
            We sent a 6-digit code to <span className="font-medium break-all text-ink">{email}</span>.
          </>
        }
      />

      {notice && <FormNotice>{notice}</FormNotice>}

      <div>
        <label htmlFor="otp" className="block text-[13px] font-medium text-ink-2">
          Confirmation code
        </label>
        <div className="relative mt-1.5">
          <div className="grid grid-cols-6 gap-2" aria-hidden>
            {Array.from({ length: CELLS }, (_, i) => {
              const isActive = focused && !pending && i === activeCell;
              return (
                <div
                  key={i}
                  className={`flex h-14 items-center justify-center rounded-xl border bg-surface font-display text-2xl font-semibold text-ink transition-colors ${
                    error ? "border-critical" : isActive ? "border-accent ring-2 ring-accent/25" : "border-line"
                  }`}
                >
                  {code[i] ?? (isActive ? <span className="h-6 w-px bg-accent motion-safe:animate-pulse" /> : null)}
                </div>
              );
            })}
          </div>
          <input
            id="otp"
            ref={inputRef}
            value={code}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            // readOnly, not disabled: a disabled field loses focus, so after a wrong code
            // the next digits would go nowhere until the person clicked it again.
            readOnly={pending}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              // No maxLength: a pasted "123 456" must reach this handler whole, so the
              // space can be dropped before the length is cut.
              const digits = e.target.value.replace(/\D/g, "").slice(0, CELLS);
              setCode(digits);
              if (digits.length === CELLS && !pending) void submit(digits);
            }}
            aria-invalid={error ? true : undefined}
            className="auth-input absolute inset-0 size-full cursor-text opacity-0"
          />
        </div>
        <p className="mt-2.5 flex items-center gap-1.5 text-[13px] text-ink-2">
          <Clock aria-hidden className="size-3.5" />
          <span>
            {expiresIn > 0 ? (
              <>
                Code expires in <span className="tabular font-medium text-ink">{clock(expiresIn)}</span>
              </>
            ) : (
              "This code has expired. Request a new one."
            )}
          </span>
        </p>
      </div>

      {error && <FormError>{error}</FormError>}

      <SubmitButton pending={pending} pendingLabel="Checking…" disabled={code.length !== CELLS}>
        Confirm
      </SubmitButton>

      <p className="text-center text-[13px] text-ink-2">
        Didn&apos;t get it?{" "}
        <button
          type="button"
          onClick={resend}
          disabled={pending || resendIn > 0}
          className="font-semibold text-ink underline decoration-line decoration-2 underline-offset-4 hover:decoration-accent disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
        >
          {resendIn > 0 ? (
            <>
              Resend code in <span className="tabular">{clock(resendIn)}</span>
            </>
          ) : (
            "Resend code"
          )}
        </button>
      </p>
      <p className="text-center text-[13px]">
        <button
          type="button"
          onClick={onStartOver}
          disabled={pending}
          className="font-medium text-ink-2 underline decoration-line decoration-2 underline-offset-4 hover:text-ink hover:decoration-accent disabled:opacity-60"
        >
          {startOverLabel}
        </button>
      </p>
    </form>
  );
}
