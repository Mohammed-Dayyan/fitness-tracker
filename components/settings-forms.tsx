"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { isValidDateString } from "@/lib/shared/dates";
import { ACTIVITY_LABELS, canonicalActivity, canonicalGoal, GOAL_LABELS } from "@/lib/shared/profile-terms";
import { ACTIVITY_LEVELS, suggestTargets, type Suggestion } from "@/lib/shared/suggest-targets";
import { targetsInEffect } from "@/lib/shared/targets";

type Profile = Record<string, unknown>;
type TargetVersion = Record<string, unknown>;
type LatestWeight = { date: string; kg: number } | null;
type Status = { kind: "idle" } | { kind: "saving" } | { kind: "ok"; message: string } | { kind: "error"; message: string };

const noopSubscribe = () => () => {};

const inputCls =
  "mt-1 block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink aria-[invalid=true]:border-critical";
const str = (v: unknown) => (v == null ? "" : String(v));

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-2">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-critical-ink">
          {error}
        </p>
      )}
    </div>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "ok")
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-good-ink">
        <CheckCircle2 aria-hidden className="size-4" />
        {status.message}
      </p>
    );
  if (status.kind === "error")
    return (
      <p role="alert" className="flex items-center gap-2 text-sm text-critical-ink">
        <TriangleAlert aria-hidden className="size-4" />
        {status.message}
      </p>
    );
  return <p role="status" className="sr-only" />;
}

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) return { ok: false as const, error: "Your session expired. Sign in again.", fieldErrors: {} };
  return (await res.json()) as { ok: true; message: string } | { ok: false; error: string; fieldErrors: Record<string, string> };
}

/** Extra option that keeps a stored value which isn't one of the standard labels, explaining how it is read. */
function customOption(current: string, labels: readonly string[], canonical: string | null) {
  if (!current || labels.includes(current)) return null;
  return (
    <option value={current}>
      {current} {canonical ? `(counts as ${canonical})` : "(not used for suggestions)"}
    </option>
  );
}

export function ProfileForm({ profile, today }: { profile: Profile; today: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Client-only list: the server's and browser's timezone lists can differ,
  // which would otherwise cause a hydration mismatch.
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const timezones = isClient && typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const goal = str(profile.goal);
  const activity = str(profile.activity_level);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    // Same rule the server enforces, shown immediately.
    if (data.birth_date && data.birth_date > today) {
      setErrors({ birth_date: "Birth date can't be in the future" });
      setStatus({ kind: "error", message: "Please fix the highlighted fields." });
      return;
    }
    setStatus({ kind: "saving" });
    try {
      const res = await post({ section: "profile", ...data });
      setErrors(res.ok ? {} : res.fieldErrors);
      setStatus(res.ok ? { kind: "ok", message: res.message } : { kind: "error", message: res.error });
      if (res.ok) router.refresh();
    } catch {
      setStatus({ kind: "error", message: "Network error. Nothing was saved." });
    }
  }

  const a = (id: string) => ({
    id,
    name: id,
    "aria-invalid": errors[id] ? true : undefined,
    "aria-describedby": errors[id] ? `${id}-error` : `${id}-hint`,
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="Name" error={errors.name}>
          <input {...a("name")} defaultValue={str(profile.name)} autoComplete="name" className={inputCls} />
        </Field>
        <Field id="timezone" label="Timezone" hint="Days start at midnight in this timezone." error={errors.timezone}>
          <input {...a("timezone")} defaultValue={str(profile.timezone) || "Asia/Kolkata"} list="timezones" required className={inputCls} />
          <datalist id="timezones">
            {timezones.map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
        </Field>
        <Field id="height_cm" label="Height (cm)" error={errors.height_cm}>
          <input {...a("height_cm")} defaultValue={str(profile.height_cm)} inputMode="decimal" className={inputCls} />
        </Field>
        <Field id="goal" label="Fitness goal" error={errors.goal}>
          <select {...a("goal")} defaultValue={goal} className={inputCls}>
            <option value="">Not set</option>
            {GOAL_LABELS.map((g) => (
              <option key={g}>{g}</option>
            ))}
            {customOption(goal, GOAL_LABELS, canonicalGoal(goal))}
          </select>
        </Field>
        <Field id="activity_level" label="Activity level" hint="Used only for suggested targets." error={errors.activity_level}>
          <select {...a("activity_level")} defaultValue={activity} className={inputCls}>
            <option value="">Not set</option>
            {ACTIVITY_LEVELS.map((l) => (
              <option key={l.label} value={l.label}>
                {l.label} ({l.hint})
              </option>
            ))}
            {customOption(activity, ACTIVITY_LABELS, canonicalActivity(activity))}
          </select>
        </Field>
        <Field id="sex" label="Sex" hint="Optional; used only for suggested targets." error={errors.sex}>
          <select {...a("sex")} defaultValue={str(profile.sex)} className={inputCls}>
            <option value="">Not set</option>
            {["male", "female", "other"].map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
            {customOption(str(profile.sex), ["male", "female", "other"], null)}
          </select>
        </Field>
        <Field id="birth_date" label="Birth date" hint="Optional; used only for suggested targets." error={errors.birth_date}>
          <input {...a("birth_date")} type="date" defaultValue={str(profile.birth_date)} min="1900-01-01" max={today} className={inputCls} />
        </Field>
      </div>
      <p className="text-xs text-ink-2">Leave a field empty to clear it. Nothing is filled in for you. Weight is recorded separately, below.</p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={status.kind === "saving"} className="inline-flex items-center gap-2 rounded-lg btn-primary px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60">
          {status.kind === "saving" && <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />}
          Save profile
        </button>
        <StatusLine status={status} />
      </div>
    </form>
  );
}

/**
 * Records one dated weigh-in. The date follows "today" until the user picks
 * one themselves, so a page left open overnight never silently keeps
 * yesterday's date, and a deliberate choice is never overwritten.
 */
export function WeighInForm({ latestWeight, today }: { latestWeight: LatestWeight; today: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [chosen, setChosen] = useState<string | null>(null);
  const [kg, setKg] = useState("");
  const date = chosen ?? today;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus({ kind: "saving" });
    try {
      const res = await post({ section: "weight", date, weight_kg: kg });
      setErrors(res.ok ? {} : res.fieldErrors);
      setStatus(res.ok ? { kind: "ok", message: res.message } : { kind: "error", message: res.error });
      if (res.ok) {
        setKg(""); // the value was recorded; it must not be submitted again by accident
        router.refresh();
      }
    } catch {
      setStatus({ kind: "error", message: "Network error. Nothing was saved." });
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="weigh-date" label="Date" hint="The day this weight belongs to." error={errors.date}>
          <input
            id="weigh-date"
            type="date"
            value={date}
            max={today}
            min="1900-01-01"
            onChange={(e) => setChosen(e.target.value)}
            aria-invalid={errors.date ? true : undefined}
            aria-describedby={errors.date ? "weigh-date-error" : "weigh-date-hint"}
            className={inputCls}
          />
        </Field>
        <Field
          id="weigh-kg"
          label="Weight (kg)"
          hint={latestWeight ? `Latest recorded: ${latestWeight.kg} kg on ${latestWeight.date}.` : "No weigh-in recorded yet."}
          error={errors.weight_kg}
        >
          <input
            id="weigh-kg"
            inputMode="decimal"
            value={kg}
            onChange={(e) => setKg(e.target.value)}
            aria-invalid={errors.weight_kg ? true : undefined}
            aria-describedby={errors.weight_kg ? "weigh-kg-error" : "weigh-kg-hint"}
            className={inputCls}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={status.kind === "saving"} className="inline-flex items-center gap-2 rounded-lg btn-primary px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60">
          {status.kind === "saving" && <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />}
          Record weigh-in
        </button>
        <StatusLine status={status} />
      </div>
    </form>
  );
}

const TARGET_FIELDS = [
  { key: "calories", label: "Calories (kcal)" },
  { key: "protein_g", label: "Protein (g)" },
  { key: "carbs_g", label: "Carbohydrates (g)" },
  { key: "fat_g", label: "Fat (g)" },
  { key: "fiber_g", label: "Fiber (g)" },
  { key: "steps", label: "Steps" },
  { key: "goal_weight_kg", label: "Goal weight (kg)" },
] as const;

export function TargetsForm({
  versions,
  profile,
  latestWeight,
  today,
}: {
  versions: TargetVersion[];
  profile: Profile;
  latestWeight: LatestWeight;
  today: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  // Follows "today" (e.g. after midnight) until the user chooses a date.
  const [chosen, setChosen] = useState<string | null>(null);
  const from = chosen ?? today;

  // The version a new save for this date inherits from: the same lookup the server uses.
  const inherits = isValidDateString(from) ? targetsInEffect(versions, from) : null;
  const sameDate = versions.some((v) => v.effective_from === from);

  function suggest() {
    const s = suggestTargets({
      sex: (profile.sex as string | null) ?? null,
      birthDate: (profile.birth_date as string | null) ?? null,
      today,
      heightCm: (profile.height_cm as number | null) ?? null,
      weight: latestWeight,
      activityLevel: (profile.activity_level as string | null) ?? null,
      goal: (profile.goal as string | null) ?? null,
    });
    setSuggestion(s);
    if (s.ok) setValues((v) => ({ ...v, ...Object.fromEntries(Object.entries(s.values).map(([k, n]) => [k, String(n)])) }));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus({ kind: "saving" });
    try {
      const res = await post({ section: "targets", effective_from: from, ...values });
      setErrors(res.ok ? {} : res.fieldErrors);
      setStatus(res.ok ? { kind: "ok", message: res.message } : { kind: "error", message: res.error });
      if (res.ok) {
        setValues({});
        setSuggestion(null);
        router.refresh();
      }
    } catch {
      setStatus({ kind: "error", message: "Network error. Nothing was saved." });
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="effective_from"
          label="Effective from"
          hint={
            sameDate
              ? "A version already exists for this date; saving updates it."
              : inherits
                ? `Blank fields copy from the version effective ${inherits.effective_from}. Days before this date keep the targets they had.`
                : "No earlier version: blank fields stay unset. Days before this date keep the targets they had."
          }
          error={errors.effective_from}
        >
          <input
            id="effective_from"
            type="date"
            value={from}
            onChange={(e) => setChosen(e.target.value)}
            aria-invalid={errors.effective_from ? true : undefined}
            aria-describedby={errors.effective_from ? "effective_from-error" : "effective_from-hint"}
            className={inputCls}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TARGET_FIELDS.map((f) => {
          const inherited = inherits?.[f.key];
          return (
            <Field
              key={f.key}
              id={`t-${f.key}`}
              label={f.label}
              hint={inherited != null ? `Blank keeps ${inherited}` : "Blank leaves it unset"}
              error={errors[f.key]}
            >
              <input
                id={`t-${f.key}`}
                inputMode="decimal"
                value={values[f.key] ?? ""}
                placeholder={inherited != null ? String(inherited) : ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                aria-invalid={errors[f.key] ? true : undefined}
                aria-describedby={errors[f.key] ? `t-${f.key}-error` : `t-${f.key}-hint`}
                className={inputCls}
              />
            </Field>
          );
        })}
      </div>

      {suggestion && !suggestion.ok && (
        <p role="status" className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-2">
          To suggest targets, first save these in your profile and weigh-ins: {suggestion.missing.join(", ")}.
        </p>
      )}
      {suggestion?.ok && (
        <div role="status" className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink">
          <p className="font-medium">Suggested targets filled in. These are estimates: review and edit them before saving.</p>
          {suggestion.warnings.map((w) => (
            <p key={w} className="mt-1 flex items-start gap-2 text-warning-ink">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {w}
            </p>
          ))}
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-ink-2">
            {suggestion.basis.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-ink-2">
        Saving creates a target version that applies from the chosen date. Blank fields copy the value from the version in
        effect on that date, so you can change only what you need. Saving again for the same date updates that version.
        Suggestions use your saved profile and latest weigh-in.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={status.kind === "saving"} className="inline-flex items-center gap-2 rounded-lg btn-primary px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60">
          {status.kind === "saving" && <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />}
          Save targets
        </button>
        <button type="button" onClick={suggest} className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2">
          <Sparkles aria-hidden className="size-4" />
          Suggest targets
        </button>
        <StatusLine status={status} />
      </div>
    </form>
  );
}
