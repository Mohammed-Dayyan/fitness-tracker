"use client";

import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtDateShort, fmtNumber } from "@/lib/shared/format";
import { axisTick, ChartFrame, compact, dateTick, gridProps, Legend, TooltipCard, tooltipTitle } from "./kit";

export type TargetPoint = {
  date: string;
  value: number | null;
  target: number | null;
  /** Some entries that day lack this value: the bar is a lower bound. */
  partial?: boolean;
};

/**
 * Daily values as columns with the (versioned) target as a step line.
 * One measure, one axis. Partial days are drawn faded and flagged in the
 * tooltip and table.
 */
export function TargetBarChart({
  data,
  summary,
  color,
  label,
  unit,
  height = 240,
}: {
  summary?: string;
  data: TargetPoint[];
  color: string;
  label: string;
  unit: string;
  height?: number;
}) {
  const hasTarget = data.some((d) => d.target != null);
  const hasPartial = data.some((d) => d.partial);
  return (
    <ChartFrame
      summary={summary}
      label={`${label} by day`}
      columns={["Date", `${label}${unit ? ` (${unit})` : ""}`, "Target", "Note"]}
      rows={data.map((d) => [fmtDateShort(d.date), d.value == null ? null : fmtNumber(d.value), d.target == null ? null : fmtNumber(d.target), d.partial ? "partial" : ""])}
    >
      <Legend
        items={[
          { label, color, kind: "bar" },
          ...(hasTarget ? [{ label: "Target", color: "var(--ink-2)", kind: "line" as const }] : []),
          ...(hasPartial ? [{ label: "Partial (some entries unknown)", color: `color-mix(in oklab, ${color} 40%, var(--surface))`, kind: "bar" as const }] : []),
        ]}
      />
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="20%">
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" tickFormatter={dateTick} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--axis)" }} minTickGap={16} />
            <YAxis tickFormatter={compact} tick={axisTick} tickLine={false} axisLine={false} width={44} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload, label: date }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as TargetPoint;
                return (
                  <TooltipCard
                    title={tooltipTitle(date)}
                    rows={[
                      { label, value: p.value == null ? "Not logged" : `${fmtNumber(p.value)} ${unit}`.trim(), color },
                      ...(p.target != null ? [{ label: "Target", value: `${fmtNumber(p.target)} ${unit}`.trim(), color: "var(--ink-2)", dashed: true }] : []),
                    ]}
                    note={p.partial ? "Partial: some entries lack this value" : undefined}
                  />
                );
              }}
            />
            <Bar dataKey="value" name={label} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.date} fill={color} fillOpacity={d.partial ? 0.5 : 1} />
              ))}
            </Bar>
            {hasTarget && (
              <Line dataKey="target" name="Target" type="stepAfter" stroke="var(--ink-2)" strokeWidth={1.5} dot={false} activeDot={false} isAnimationActive={false} connectNulls={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
