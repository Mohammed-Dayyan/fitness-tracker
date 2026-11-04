import { AlertCircle, ArrowRight, Loader2, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

/** Title block of a sign-in or sign-up screen. */
export function AuthHeading({
  title,
  subtitle,
  icon: Icon,
}: {
  title: string;
  subtitle?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div>
      {Icon && (
        <span className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-surface-2 text-accent-ink">
          <Icon aria-hidden className="size-6" />
        </span>
      )}
      <h1 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight text-ink">{title}</h1>
      {subtitle && <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{subtitle}</p>}
    </div>
  );
}

type TextFieldProps = Omit<ComponentProps<"input">, "id" | "className"> & {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Sits inside the field on the right (e.g. the show/hide button). */
  trailing?: ReactNode;
};

export function TextField({ id, label, icon: Icon, trailing, ...input }: TextFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] font-medium text-ink-2">
        {label}
      </label>
      <div className="relative mt-1.5">
        <Icon aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" />
        <input
          id={id}
          {...input}
          className={`auth-input h-11 w-full rounded-xl border border-line bg-surface pl-10 text-[15px] text-ink transition-colors placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/25 ${trailing ? "pr-11" : "pr-3"}`}
        />
        {trailing && <div className="absolute inset-y-0 right-0 flex items-center">{trailing}</div>}
      </div>
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-xl bg-critical/10 px-3 py-2.5 text-[13px] leading-snug text-critical-ink">
      <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function FormNotice({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="rounded-xl bg-surface-2 px-3 py-2.5 text-[13px] leading-snug text-ink-2">
      {children}
    </p>
  );
}

export function SubmitButton({
  pending,
  pendingLabel,
  disabled,
  children,
}: {
  pending: boolean;
  pendingLabel: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="btn-primary flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
    >
      {pending ? (
        <>
          <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" />
          {pendingLabel}
        </>
      ) : (
        <>
          {children}
          <ArrowRight aria-hidden className="size-4" />
        </>
      )}
    </button>
  );
}
