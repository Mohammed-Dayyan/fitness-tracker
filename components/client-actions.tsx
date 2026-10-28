"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { COPY_FAILED_MESSAGE, copyText } from "@/lib/client/clipboard";
import { isValidDateString } from "@/lib/shared/dates";
import { Check, ChevronLeft, ChevronRight, ClipboardCopy, Download, Loader2, TriangleAlert } from "lucide-react";

/** How long the picker must sit unchanged on a complete date before the page navigates to it. */
const PICKER_SETTLE_MS = 400;

export function DateNav({ date, prev, next, today, basePath = "/" }: { date: string; prev: string; next: string; today: string; basePath?: string }) {
  const router = useRouter();
  const href = (d: string) => (d === today ? basePath : `${basePath}?date=${d}`);
  // While typing, the input shows what was typed; the page only follows once the
  // value is a real date (year 1900–2200) that has stopped changing. Typing a
  // year digit by digit passes through 0001, 0002 … which must never navigate.
  const [draft, setDraft] = useState<{ base: string; value: string } | null>(null);
  const shown = draft && draft.base === date ? draft.value : date;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  function onPick(value: string) {
    setDraft({ base: date, value });
    clearTimeout(timer.current);
    if (isValidDateString(value) && value !== date) timer.current = setTimeout(() => router.push(href(value)), PICKER_SETTLE_MS);
  }
  const btn = "inline-flex size-9 items-center justify-center rounded-lg border border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink";
  return (
    <div className="flex items-center gap-2">
      <Link href={href(prev)} className={btn} aria-label="Previous day">
        <ChevronLeft aria-hidden className="size-4" />
      </Link>
      <label className="sr-only" htmlFor="date-picker">
        Choose date
      </label>
      <input
        id="date-picker"
        type="date"
        value={shown}
        min="1900-01-01"
        max="2200-12-31"
        onChange={(e) => onPick(e.target.value)}
        className="h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink"
      />
      <Link href={href(next)} className={btn} aria-label="Next day">
        <ChevronRight aria-hidden className="size-4" />
      </Link>
      {date !== today && (
        <Link href={basePath} className="h-9 rounded-lg border border-line bg-surface px-3 text-sm leading-9 font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
          Today
        </Link>
      )}
    </div>
  );
}

type CopyState = "idle" | "loading" | "copied" | "error";

/** Fetches an export endpoint and copies the result to the clipboard. */
export function CopyButton({
  url,
  label,
  json = false,
  variant = "secondary",
  disabled = false,
}: {
  url: string;
  label: string;
  json?: boolean;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    setState("loading");
    setError(null);
    try {
      const res = await fetch(url);
      if (res.status === 401) throw new Error("Your session expired. Sign in again.");
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Request failed (${res.status})`);
      const text = json ? JSON.stringify(await res.json(), null, 2) : await res.text();
      if (!(await copyText(text))) throw new Error(COPY_FAILED_MESSAGE);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch (e) {
      setState("error");
      setError(e instanceof Error && e.message ? e.message : COPY_FAILED_MESSAGE);
    }
  }

  const Icon = state === "loading" ? Loader2 : state === "copied" ? Check : state === "error" ? TriangleAlert : ClipboardCopy;
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={copy}
        disabled={disabled || state === "loading"}
        className={
          variant === "primary"
            ? "inline-flex items-center gap-2 rounded-lg btn-primary px-3 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60"
            : "inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-60"
        }
      >
        <Icon aria-hidden className={`size-4 ${state === "loading" ? "motion-safe:animate-spin" : ""}`} />
        {state === "copied" ? "Copied" : label}
      </button>
      <span role="status" className="text-xs text-critical-ink">
        {error}
      </span>
    </span>
  );
}

type DownloadState = { kind: "idle" } | { kind: "loading" } | { kind: "done"; file: string } | { kind: "error"; message: string };

/** Downloads an export with visible progress and outcome (a plain link gives no feedback). */
export function DownloadButton({ url, label, disabled = false }: { url: string; label: string; disabled?: boolean }) {
  const [state, setState] = useState<DownloadState>({ kind: "idle" });

  async function download() {
    setState({ kind: "loading" });
    try {
      const res = await fetch(url);
      if (res.status === 401) throw new Error("Your session expired. Sign in again.");
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Download failed (${res.status})`);
      const file = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "fitness-export.json";
      const href = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = href;
      a.download = file;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      setState({ kind: "done", file });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : "Download failed." });
    }
  }

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={download}
        disabled={disabled || state.kind === "loading"}
        className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
      >
        {state.kind === "loading" ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" /> : <Download aria-hidden className="size-4" />}
        {label}
      </button>
      <span role="status" className={`text-xs ${state.kind === "error" ? "text-critical-ink" : "text-good-ink"}`}>
        {state.kind === "done" ? `Download started: ${state.file}` : state.kind === "error" ? state.message : ""}
      </span>
    </span>
  );
}
