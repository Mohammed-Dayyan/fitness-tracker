"use client";

import { Check, Circle, Eye, EyeOff, Lock } from "lucide-react";
import { useState } from "react";
import { TextField } from "@/components/auth-ui";
import { PASSWORD_RULES } from "@/lib/shared/password-rules";

/** Password input with a show/hide toggle. */
export function PasswordInput({
  id,
  label,
  value,
  onChange,
  autoComplete,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  describedBy?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <TextField
      id={id}
      name={id}
      label={label}
      icon={Lock}
      type={shown ? "text" : "password"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={autoComplete}
      aria-describedby={describedBy}
      required
      trailing={
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          className="flex h-full w-11 items-center justify-center rounded-r-xl text-muted hover:text-ink"
        >
          {shown ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
        </button>
      }
    />
  );
}

/** What the password has to be, always visible, turning green once it is. Uses the rules the server enforces. */
export function PasswordHint({ id, password }: { id: string; password: string }) {
  return (
    <ul id={id} aria-label="Password requirements" className="mt-2 space-y-1">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <li key={rule.id} className={`flex items-center gap-1.5 text-xs ${met ? "text-good-ink" : "text-ink-2"}`}>
            {met ? <Check aria-hidden className="size-3.5" /> : <Circle aria-hidden className="size-3.5" />}
            <span>
              {rule.label}
              <span className="sr-only">{met ? " (met)" : " (not met yet)"}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
