"use client";

import { useState, type ReactNode } from "react";
import { Table2 } from "lucide-react";
import { fmtDateMedium, fmtDateShort, fmtNumber } from "@/lib/shared/format";

export const axisTick = { fill: "var(--muted)", fontSize: 12 };
export const gridProps = { stroke: "var(--grid)", vertical: false } as const;

export function compact(v: number): string {
  return Math.abs(v) >= 1000 ? `${fmtNumber(v / 1000, 1)}K` : fmtNumber(v);
}

export const dateTick = (d: string) => fmtDateShort(d);

export type TooltipRow = { label: string; value: string; color?: string; dashed?: boolean };

/** Card-styled tooltip; values in ink, identity carried by the swatch. */
export function TooltipCard({ title, rows, note }: { title: string; rows: TooltipRow[]; note?: string }) {
  return (
    <div className="min-w-40 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-ink">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center justify-between gap-4 text-ink-2">
          <span className="flex items-center gap-1.5">
            {r.color && (
              <span
                aria-hidden
                className={r.dashed ? "h-0.5 w-3" : "size-2 rounded-full"}
                style={{ background: r.color }}
              />
            )}
            {r.label}
          </span>
          <span className="tabular font-medium text-ink">{r.value}</span>
        </p>
      ))}
      {note && <p className="mt-1 text-[11px] text-warning-ink">{note}</p>}
    </div>
  );
}

export function tooltipTitle(date: unknown): string {
  return typeof date === "string" ? fmtDateMedium(date) : String(date ?? "");
}

export function Legend({ items }: { items: { label: string; color: string; kind: "dot" | "line" | "bar" | "rule" }[] }) {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={
              i.kind === "dot" ? "size-2.5 rounded-full" : i.kind === "bar" ? "h-2.5 w-2 rounded-sm" : i.kind === "rule" ? "h-px w-4" : "h-0.5 w-4 rounded"
            }
            style={{ background: i.color }}
          />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Wraps a chart with an accessible table view of the same data, so no value
 * is available only through colour or hover.
 */
export function ChartFrame({
  label,
  summary,
  children,
  columns,
  rows,
}: {
  label: string;
  /** One-sentence description of what the chart shows (visible, and read by screen readers). */
  summary?: string;
  children: ReactNode;
  columns: string[];
  rows: (string | number | null)[][];
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <figure aria-label={label}>
      {summary && <figcaption className="mb-2 text-xs text-ink-2">{summary}</figcaption>}
      {showTable ? (
        <div className="max-h-72 overflow-auto rounded-lg border border-line">
          <table className="tabular w-full text-left text-sm">
            <caption className="sr-only">{label}</caption>
            <thead className="sticky top-0 bg-surface-2 text-xs text-ink-2">
              <tr>
                {columns.map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  {r.map((cell, j) => (
                    <td key={j} className="px-3 py-1.5 text-ink">
                      {cell ?? "–"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
      <button
        type="button"
        onClick={() => setShowTable((v) => !v)}
        className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-ink-2 hover:text-ink"
      >
        <Table2 aria-hidden className="size-3.5" />
        {showTable ? "Show chart" : "Show table"}
      </button>
    </figure>
  );
}
