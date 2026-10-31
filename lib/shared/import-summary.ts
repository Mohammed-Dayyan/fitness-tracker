export type ImportCounts = { created: number; updated: number; unchanged: number; deleted: number; rejected: number };

/**
 * The one-line toast after a successful import: what changed, then anything
 * that was skipped. Deliberately never says "Import applied" (that heading
 * stays on the page as the permanent record).
 */
export function importToastMessage(c: ImportCounts): string {
  const parts = [
    c.created ? `${c.created} created` : null,
    c.updated ? `${c.updated} updated` : null,
    c.deleted ? `${c.deleted} deleted` : null,
  ].filter(Boolean);
  const head = parts.length ? `Imported: ${parts.join(", ")}` : "No changes: everything was already saved";
  const skipped = c.rejected ? ` ${c.rejected} ${c.rejected === 1 ? "record was" : "records were"} skipped.` : "";
  return parts.length || skipped ? `${head}.${skipped}` : `${head}.`;
}
