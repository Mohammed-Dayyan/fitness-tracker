"use client";

import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtDateShort, fmtNumber } from "@/lib/shared/format";
import { axisTick, ChartFrame, dateTick, gridProps, Legend, TooltipCard, tooltipTitle } from "./kit";

export type WeightPoint = { date: string; weight_kg: number | null; weight_avg7: number | null };

/** Daily weigh-ins as dots with the 7-day average as a line; optional goal rule. */
export function WeightChart({ data, summary, goal, height = 260 }: { data: WeightPoint[]; summary?: string; goal?: number | null; height?: number }) {
  const values = data.flatMap((d) => [d.weight_kg, d.weight_avg7]).filter((v): v is number => v != null);
  if (goal != null) values.push(goal);
  const min = Math.floor(Math.min(...values) - 1);
  const max = Math.ceil(Math.max(...values) + 1);
  // Even, whole-kg ticks (1, 2 or 5 kg apart) instead of the library's guesses.
  const span = max - min;
  const step = span <= 6 ? 1 : span <= 14 ? 2 : 5;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(t);
  const color = "var(--s-weight)";
  return (
    <ChartFrame
      summary={summary}
      label="Body weight by day"
      columns={["Date", "Weight (kg)", "7-day average (kg)"]}
      rows={data.filter((d) => d.weight_kg != null || d.weight_avg7 != null).map((d) => [fmtDateShort(d.date), d.weight_kg == null ? null : fmtNumber(d.weight_kg, 1), d.weight_avg7 == null ? null : fmtNumber(d.weight_avg7, 1)])}
    >
      <Legend
        items={[
          { label: "Weigh-in", color, kind: "dot" },
          { label: "7-day average", color, kind: "line" },
          ...(goal != null ? [{ label: `Goal ${fmtNumber(goal, 1)} kg`, color: "var(--ink-2)", kind: "rule" as const }] : []),
        ]}
      />
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="date" tickFormatter={dateTick} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--axis)" }} minTickGap={16} />
            <YAxis domain={[min, max]} ticks={ticks} tick={axisTick} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
            {goal != null && <ReferenceLine y={goal} stroke="var(--ink-2)" strokeWidth={1} />}
            <Tooltip
              cursor={{ stroke: "var(--axis)", strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as WeightPoint;
                return (
                  <TooltipCard
                    title={tooltipTitle(label)}
                    rows={[
                      { label: "Weigh-in", value: p.weight_kg == null ? "–" : `${fmtNumber(p.weight_kg, 1)} kg`, color },
                      { label: "7-day avg", value: p.weight_avg7 == null ? "–" : `${fmtNumber(p.weight_avg7, 1)} kg`, color, dashed: true },
                    ]}
                  />
                );
              }}
            />
            <Line dataKey="weight_avg7" name="7-day average" type="monotone" stroke={color} strokeWidth={2} dot={false} activeDot={false} connectNulls isAnimationActive={false} />
            <Line
              dataKey="weight_kg"
              name="Weigh-in"
              stroke="none"
              dot={{ r: 4, fill: color, stroke: "var(--surface)", strokeWidth: 2 }}
              activeDot={{ r: 6, fill: color, stroke: "var(--surface)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
