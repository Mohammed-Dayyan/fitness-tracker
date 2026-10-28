"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { COPY_FAILED_MESSAGE, copyText } from "@/lib/client/clipboard";
import { fmtDateMedium } from "@/lib/shared/format";
import { formatBytes, MAX_IMPORT_BYTES } from "@/lib/shared/limits";
import { AlertTriangle, CalendarClock, Check, CheckCircle2, ClipboardCopy, FileUp, Loader2, Search, Upload, X } from "lucide-react";

type Action = "create" | "update" | "unchanged" | "delete" | "rejected";
type RecordOutcome = {
  kind: string;
  ref: string;
  action: Action;
  id: string | null;
  id_generated?: true;
  date?: string;
  previous_date?: string;
  changes?: string[];
  errors?: string[];
  warnings?: string[];
  record?: Record<string, unknown>;
};
type Report = {
  ok: true;
  mode: "preview" | "commit";
  counts: { created: number; updated: number; unchanged: number; deleted: number; rejected: number };
  preview_token: string;
  records: RecordOutcome[];
  assigned_ids: { ref: string; kind: string; id: string }[];
  errors: string[];
  warnings: string[];
};
type Failure = { error: string; errors?: string[]; preview?: Report };

const TOO_LARGE = `This JSON is larger than the ${formatBytes(MAX_IMPORT_BYTES)} limit. Split it into smaller imports.`;

const ACTION_STYLE: Record<Action, { label: string; cls: string }> = {
  create: { label: "Create", cls: "bg-good/12 text-good-ink" },
  update: { label: "Update", cls: "bg-[color-mix(in_oklab,var(--s-calories)_14%,transparent)] text-ink" },
  unchanged: { label: "Unchanged", cls: "bg-surface-2 text-ink-2" },
  delete: { label: "Delete", cls: "bg-critical/12 text-critical-ink" },
  rejected: { label: "Rejected", cls: "bg-warning/18 text-warning-ink" },
};

const KIND_LABEL: Record<string, string> = {
  profile: "Profile",
  targets: "Targets",
  food_entries: "Food",
  workouts: "Workout",
  exercise_sets: "Set",
  cardio_sessions: "Cardio",
  daily_activity: "Activity",
  body_measurements: "Measurement",
  daily_notes: "Note",
};

function describe(o: RecordOutcome): string {
  const r = o.record ?? {};
  const pick = (k: string) => (typeof r[k] === "string" || typeof r[k] === "number" ? String(r[k]) : null);
  switch (o.kind) {
    case "food_entries":
      return [pick("name"), pick("meal") && `(${pick("meal")})`, r.calories != null ? `${r.calories} kcal` : r.name ? "kcal unknown" : null].filter(Boolean).join(" ");
    case "workouts":
      return pick("name") ?? "Workout";
    case "exercise_sets":
      return [pick("exercise"), r.set_number != null ? `set ${r.set_number}` : null, r.reps != null ? `${r.reps}${r.weight_kg != null ? ` × ${r.weight_kg} kg` : ""}` : null].filter(Boolean).join(" · ");
    case "cardio_sessions":
      return [pick("activity"), r.duration_min != null ? `${r.duration_min} min` : null].filter(Boolean).join(" · ");
    case "daily_activity":
      return [r.steps != null ? `${r.steps} steps` : null, r.weight_kg != null ? `${r.weight_kg} kg` : null].filter(Boolean).join(" · ");
    case "daily_notes":
      return (pick("text") ?? "").slice(0, 60);
    case "targets":
      return [r.calories != null ? `${r.calories} kcal` : null, r.protein_g != null ? `P ${r.protein_g} g` : null].filter(Boolean).join(" · ");
    default:
      return "";
  }
}

function Counts({ counts }: { counts: Report["counts"] }) {
  const items: [string, number, Action][] = [
    ["Created", counts.created, "create"],
    ["Updated", counts.updated, "update"],
    ["Deleted", counts.deleted, "delete"],
    ["Unchanged", counts.unchanged, "unchanged"],
    ["Rejected", counts.rejected, "rejected"],
  ];
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map(([label, n, a]) => (
        <li key={label} className={`tabular rounded-lg px-3 py-1.5 text-sm font-medium ${ACTION_STYLE[a].cls}`}>
          {n} {label.toLowerCase()}
        </li>
      ))}
    </ul>
  );
}

function RecordsTable({ records }: { records: RecordOutcome[] }) {
  const [filter, setFilter] = useState<"changes" | "all" | "rejected" | "unchanged">("changes");
  const [query, setQuery] = useState("");
  const shown = records.filter((r) => {
    const byFilter =
      filter === "all" ? true : filter === "changes" ? ["create", "update", "delete", "rejected"].includes(r.action) : r.action === filter;
    return byFilter && (!query || `${r.ref} ${r.id ?? ""} ${describe(r)}`.toLowerCase().includes(query.toLowerCase()));
  });
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="record-filter">Show</label>
        <select id="record-filter" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="h-8 rounded-lg border border-line bg-surface px-2 text-sm text-ink">
          <option value="changes">Changes and rejections</option>
          <option value="all">All records</option>
          <option value="rejected">Rejected only</option>
          <option value="unchanged">Unchanged only</option>
        </select>
        <div className="relative">
          <Search aria-hidden className="absolute top-2 left-2 size-4 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name or id"
            aria-label="Filter records"
            className="h-8 rounded-lg border border-line bg-surface pr-2 pl-8 text-sm text-ink"
          />
        </div>
        <span className="text-xs text-ink-2">{shown.length} shown</span>
      </div>
      <div className="max-h-[28rem] overflow-auto rounded-lg border border-line">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="sticky top-0 bg-surface-2 text-xs text-ink-2">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Action</th>
              <th scope="col" className="px-3 py-2 font-medium">Record</th>
              <th scope="col" className="px-3 py-2 font-medium">Date</th>
              <th scope="col" className="px-3 py-2 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.ref} className="border-t border-line align-top">
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACTION_STYLE[r.action].cls}`}>{ACTION_STYLE[r.action].label}</span>
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium text-ink">{KIND_LABEL[r.kind] ?? r.kind}</p>
                  <p className="font-mono text-xs break-all text-ink-2">{r.id ?? (r.id_generated ? "new id on confirm" : r.ref)}</p>
                </td>
                <td className="tabular px-3 py-2 whitespace-nowrap text-ink-2">
                  {r.date ?? "–"}
                  {r.previous_date && <span className="block text-xs">moved from {r.previous_date}</span>}
                </td>
                <td className="px-3 py-2 text-ink">
                  {describe(r)}
                  {r.changes && r.changes.length > 0 && <p className="text-xs text-ink-2">Changes: {r.changes.join(", ")}</p>}
                  {r.errors?.map((e) => (
                    <p key={e} className="text-xs text-critical-ink">{e}</p>
                  ))}
                  {r.warnings?.map((w) => (
                    <p key={w} className="text-xs text-warning-ink">{w}</p>
                  ))}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-sm text-ink-2">
                  No records match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ImportPanel({ today }: { today: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [preview, setPreview] = useState<Report | null>(null);
  const [result, setResult] = useState<Report | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const changes = preview ? preview.counts.created + preview.counts.updated + preview.counts.deleted : 0;
  // Safety net for stale dates (e.g. ChatGPT reusing yesterday's date): name
  // every other day that new or changed records will land on.
  const otherDates = preview
    ? [...new Set(preview.records.filter((r) => (r.action === "create" || r.action === "update") && r.date && r.date !== today).map((r) => r.date!))].sort()
    : [];
  const touchedDates = useMemo(
    () =>
      [...new Set((result?.records ?? []).filter((r) => ["create", "update", "delete"].includes(r.action) && r.date).map((r) => r.date!))].sort(),
    [result],
  );

  function reset(nextText = text) {
    setText(nextText);
    setPreview(null);
    setResult(null);
    setFailure(null);
    setNotice(null);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setFailure({ error: TOO_LARGE });
      return;
    }
    setFileName(file.name);
    reset(await file.text());
  }

  function parseLocal(): unknown | undefined {
    try {
      return JSON.parse(text);
    } catch (e) {
      setFailure({ error: "This is not valid JSON.", errors: [e instanceof Error ? e.message : String(e)] });
      return undefined;
    }
  }

  async function post(url: string, body: string): Promise<{ status: number; data: Report | Failure }> {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    const data = (await res.json().catch(() => ({ error: `Unexpected response (${res.status}).` }))) as Report | Failure;
    return { status: res.status, data };
  }

  async function runPreview() {
    setFailure(null);
    setResult(null);
    setNotice(null);
    if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
      setFailure({ error: TOO_LARGE });
      return;
    }
    if (!text.trim()) {
      setFailure({ error: "Paste JSON or choose a file first." });
      return;
    }
    if (parseLocal() === undefined) return;
    setBusy("preview");
    try {
      const { status, data } = await post("/api/import/preview", text);
      if (status === 401) setFailure({ error: "Your session expired. Sign in again to continue." });
      else if ("ok" in data && data.ok) setPreview(data);
      else setFailure(data as Failure);
    } catch {
      setFailure({ error: "Network error. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!preview) return;
    const payload = parseLocal();
    if (payload === undefined) return;
    setBusy("commit");
    setFailure(null);
    try {
      const { status, data } = await post("/api/import/commit", JSON.stringify({ payload, preview_token: preview.preview_token }));
      if ("ok" in data && data.ok) {
        setResult(data);
        setPreview(null);
        router.refresh();
      } else if (status === 409 && (data as Failure).preview) {
        setPreview((data as Failure).preview!);
        setNotice("Your data changed since the preview. Review the updated preview below and confirm again.");
      } else if (status === 401) {
        setFailure({ error: "Your session expired. Sign in again to continue." });
      } else {
        setFailure(data as Failure);
      }
    } catch {
      setFailure({ error: "Network error. The import may not have been applied; preview again to check." });
    } finally {
      setBusy(null);
    }
  }

  async function copyIds() {
    if (!result) return;
    const ok = await copyText(JSON.stringify({ assigned_ids: result.assigned_ids }, null, 2));
    setCopyState(ok ? "copied" : "error");
    if (ok) setTimeout(() => setCopyState("idle"), 2000);
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void onFile(e.dataTransfer.files[0]);
        }}
      >
        <label htmlFor="import-json" className="mb-1 block text-sm font-medium text-ink">
          JSON from ChatGPT
        </label>
        <textarea
          id="import-json"
          value={text}
          onChange={(e) => {
            setFileName(null);
            reset(e.target.value);
          }}
          spellCheck={false}
          rows={10}
          placeholder={'{\n  "schema_version": "1.0",\n  "date": "2026-10-27",\n  "food_entries": [ ... ]\n}'}
          className="block w-full rounded-lg border border-line bg-surface p-3 font-mono text-xs text-ink outline-none focus:ring-2 focus:ring-[color-mix(in_oklab,var(--s-calories)_35%,transparent)]"
        />
        <p className="mt-1 text-xs text-ink-2">Paste, drop a .json file here, or choose one. Nothing is saved until you confirm.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => {
            const file = e.target.files?.[0];
            // Clear the input so choosing the same file again still fires a change event.
            e.target.value = "";
            void onFile(file);
          }}
        />
        <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-2">
          <FileUp aria-hidden className="size-4" />
          Choose file
        </button>
        {fileName && <span className="text-xs text-ink-2">{fileName}</span>}
        <button
          type="button"
          onClick={runPreview}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-lg btn-primary px-3 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-60"
        >
          {busy === "preview" ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" /> : <Search aria-hidden className="size-4" />}
          Validate & preview
        </button>
        {(text || preview || result) && (
          <button type="button" onClick={() => { setFileName(null); reset(""); }} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-2 hover:text-ink">
            <X aria-hidden className="size-4" />
            Clear
          </button>
        )}
      </div>

      <div aria-live="polite" className="space-y-4">
        {failure && (
          <div role="alert" className="rounded-lg border border-critical/30 bg-critical/8 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium text-critical-ink">
              <AlertTriangle aria-hidden className="size-4" />
              {failure.error}
            </p>
            {failure.errors && failure.errors.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-6 font-mono text-xs text-ink">
                {failure.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {notice && <p className="rounded-lg bg-warning/18 px-3 py-2 text-sm text-warning-ink">{notice}</p>}

        {preview && (
          <div className="space-y-3 rounded-xl border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">Preview</h3>
              <Counts counts={preview.counts} />
            </div>
            {preview.warnings.length > 0 && (
              <details className="text-sm text-ink-2">
                <summary className="cursor-pointer text-warning-ink">{preview.warnings.length} warning(s)</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-6 text-xs">
                  {preview.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
            {otherDates.length > 0 && (
              <p role="status" className="flex items-start gap-2 rounded-lg bg-warning/18 px-3 py-2 text-sm text-warning-ink">
                <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  Records will be saved on {otherDates.slice(0, 4).map((d) => fmtDateMedium(d)).join(", ")}
                  {otherDates.length > 4 ? ` and ${otherDates.length - 4} more days` : ""}, not today ({fmtDateMedium(today)}). If they
                  belong to today, change &quot;date&quot; in the JSON before confirming.
                </span>
              </p>
            )}
            <RecordsTable records={preview.records} />
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
              <button
                type="button"
                onClick={confirm}
                disabled={busy !== null || changes === 0}
                className="inline-flex items-center gap-2 rounded-lg btn-primary px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {busy === "commit" ? <Loader2 aria-hidden className="size-4 motion-safe:animate-spin" /> : <Upload aria-hidden className="size-4" />}
                {changes === 0 ? "Nothing to apply" : `Confirm import (${changes} change${changes === 1 ? "" : "s"})`}
              </button>
              {preview.counts.rejected > 0 && changes > 0 && (
                <p className="text-xs text-ink-2">{preview.counts.rejected} rejected record(s) will be skipped; fix them and import again.</p>
              )}
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-3 rounded-xl border border-good/30 bg-good/6 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-good-ink">
              <CheckCircle2 aria-hidden className="size-4" />
              Import applied
            </p>
            <Counts counts={result.counts} />
            {touchedDates.length > 0 && (
              <p className="flex flex-wrap gap-2 text-sm text-ink-2">
                View:
                {touchedDates.slice(0, 6).map((d) => (
                  <Link key={d} href={`/?date=${d}`} className="font-medium text-ink underline">
                    {d}
                  </Link>
                ))}
                {touchedDates.length > 6 && <span>and {touchedDates.length - 6} more days</span>}
              </p>
            )}
            {result.assigned_ids.length > 0 && (
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-sm text-ink">{result.assigned_ids.length} new ID(s) assigned by the tracker</p>
                  <button type="button" onClick={copyIds} className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-2 hover:text-ink">
                    {copyState === "copied" ? <Check aria-hidden className="size-3.5" /> : <ClipboardCopy aria-hidden className="size-3.5" />}
                    {copyState === "copied" ? "Copied" : "Copy IDs for ChatGPT"}
                  </button>
                </div>
                <p role="status" className="mb-1 text-xs text-critical-ink">
                  {copyState === "error" ? COPY_FAILED_MESSAGE : ""}
                </p>
                <ul className="max-h-40 overflow-auto rounded-lg border border-line bg-surface p-2 font-mono text-xs text-ink-2 select-text">
                  {result.assigned_ids.map((a) => (
                    <li key={a.ref}>
                      {a.ref} → <span className="text-ink">{a.id}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <RecordsTable records={result.records} />
          </div>
        )}
      </div>
    </div>
  );
}
