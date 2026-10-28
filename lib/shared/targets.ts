type Version = Record<string, unknown>;

/**
 * The target version in effect on a date: the latest one whose effective_from
 * is on or before it. Used identically by the server (every comparison and
 * every new-version inheritance) and by the Settings form's "blank keeps…" hints.
 */
export function targetsInEffect<T extends Version>(versions: T[], date: string): T | null {
  let best: T | null = null;
  for (const t of versions) {
    const from = t.effective_from as string;
    if (from <= date && (!best || from >= (best.effective_from as string))) best = t;
  }
  return best;
}
