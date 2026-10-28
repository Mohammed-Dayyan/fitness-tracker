"use client";

import { useState } from "react";
import { isValidDateString } from "@/lib/shared/dates";
import { CopyButton, DownloadButton } from "./client-actions";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const input = "h-9 w-full min-w-0 rounded-lg border border-line bg-surface px-2 text-sm text-ink";

export function ExportPanel({ today, defaultFrom }: { today: string; defaultFrom: string }) {
  const [day, setDay] = useState(today);
  // Month is chosen with two selects, not <input type="month">, which desktop
  // Safari and Firefox don't support (they show a plain text box).
  const [year, setYear] = useState(today.slice(0, 4));
  const [monthNo, setMonthNo] = useState(today.slice(5, 7));
  const month = `${year}-${monthNo}`;
  const thisYear = Number(today.slice(0, 4));
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(today);
  const dayOk = isValidDateString(day);
  const rangeOk = isValidDateString(from) && isValidDateString(to) && from <= to;

  return (
    <div className="space-y-6">
      <section aria-labelledby="copy-json">
        <h3 id="copy-json" className="text-sm font-semibold text-ink">Copy records as JSON</h3>
        <p className="mt-1 mb-3 text-sm text-ink-2">
          Paste into ChatGPT when it needs exact entries or their IDs, for example to correct a meal.
        </p>
        <div className="grid gap-4">
          <div className="flex max-w-lg items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor="export-day" className="mb-1 block text-xs text-ink-2">Day</label>
              <input id="export-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} className={input} />
            </div>
            <CopyButton url={`/api/export?scope=day&date=${day}`} label="Copy day" json disabled={!dayOk} />
          </div>
          <div className="flex max-w-lg items-end gap-2">
            <fieldset className="min-w-0 flex-1">
              <legend className="mb-1 text-xs text-ink-2">Month</legend>
              <div className="flex gap-2">
                <label className="sr-only" htmlFor="export-month">Month name</label>
                <select id="export-month" value={monthNo} onChange={(e) => setMonthNo(e.target.value)} className={input}>
                  {MONTH_NAMES.map((name, i) => (
                    <option key={name} value={String(i + 1).padStart(2, "0")}>
                      {name}
                    </option>
                  ))}
                </select>
                <label className="sr-only" htmlFor="export-year">Year</label>
                <select id="export-year" value={year} onChange={(e) => setYear(e.target.value)} className={`${input} max-w-24`}>
                  {Array.from({ length: 11 }, (_, i) => String(thisYear - i)).map((y) => (
                    <option key={y}>{y}</option>
                  ))}
                </select>
              </div>
            </fieldset>
            <CopyButton url={`/api/export?scope=month&month=${month}`} label="Copy month" json />
          </div>
        </div>
      </section>

      <section aria-labelledby="download-files" className="border-t border-line pt-5">
        <h3 id="download-files" className="text-sm font-semibold text-ink">Download files</h3>
        <p className="mt-1 mb-3 text-sm text-ink-2">
          Files use the import format, so they can be re-imported as they are. Re-importing changes nothing.
        </p>
        <div className="space-y-3">
          <DownloadButton url="/api/export?scope=all&download=1" label="Complete history" />
          <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
            <div className="min-w-0">
              <label htmlFor="export-from" className="mb-1 block text-xs text-ink-2">From</label>
              <input id="export-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} aria-describedby="range-error" />
            </div>
            <div className="min-w-0">
              <label htmlFor="export-to" className="mb-1 block text-xs text-ink-2">To</label>
              <input id="export-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} aria-describedby="range-error" />
            </div>
          </div>
          <DownloadButton url={`/api/export?scope=range&from=${from}&to=${to}&download=1`} label="Selected range" disabled={!rangeOk} />
          <p id="range-error" className="text-xs text-critical-ink">
            {rangeOk ? "" : "The start date must be on or before the end date."}
          </p>
        </div>
      </section>
    </div>
  );
}
