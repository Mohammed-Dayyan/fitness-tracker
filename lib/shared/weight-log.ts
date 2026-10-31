export type WeightLogInput = { date: string; weight_kg: number | null; weight_avg7: number | null };

export type WeightLogRow = {
  date: string;
  /** null on a day with no weigh-in. */
  weight_kg: number | null;
  /** kg since the previous weigh-in inside the range; null for the first one and for gap days. */
  change_kg: number | null;
  weight_avg7: number | null;
};

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Every day of the range, newest first, with the change since the previous
 * weigh-in. Days without a weigh-in stay in the list (so a forgotten day can
 * be filled in) and carry no change. The first weigh-in in the range has no
 * earlier one to compare with, so its change is null rather than a guess.
 */
export function buildWeightLog(days: WeightLogInput[]): WeightLogRow[] {
  const ascending = [...days].sort((a, b) => a.date.localeCompare(b.date));
  let previous: number | null = null;
  const rows: WeightLogRow[] = ascending.map((d) => {
    let change: number | null = null;
    if (d.weight_kg != null) {
      if (previous != null) change = round1(d.weight_kg - previous);
      previous = d.weight_kg;
    }
    return { date: d.date, weight_kg: d.weight_kg, change_kg: change, weight_avg7: d.weight_avg7 };
  });
  return rows.reverse();
}
