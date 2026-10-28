import "server-only";
import { prisma } from "@/lib/server/db";
import { applyPlan, buildPlan, parseEnvelope, type Plan, type RecordOutcome } from "./plan";
import { SCHEMA_VERSION } from "./spec";

export type ImportCounts = { created: number; updated: number; unchanged: number; deleted: number; rejected: number };

export type ImportReport = {
  ok: true;
  mode: "preview" | "commit";
  schema_version: string;
  counts: ImportCounts;
  /** Pass back to commit; it fails if the data changed since the preview. */
  preview_token: string;
  records: RecordOutcome[];
  /** IDs created by the server (commit only; previews show id_generated). */
  assigned_ids: { ref: string; kind: string; id: string }[];
  errors: string[];
  warnings: string[];
};

export type ImportFailure = {
  ok: false;
  status: 400 | 409 | 422;
  error: string;
  errors: string[];
  preview?: ImportReport;
};

function report(plan: Plan, mode: "preview" | "commit"): ImportReport {
  const counts: ImportCounts = { created: 0, updated: 0, unchanged: 0, deleted: 0, rejected: 0 };
  const errors: string[] = [];
  const warnings = [...plan.warnings];
  const assigned: ImportReport["assigned_ids"] = [];
  for (const o of plan.outcomes) {
    if (o.action === "create") counts.created++;
    else if (o.action === "update") counts.updated++;
    else if (o.action === "unchanged") counts.unchanged++;
    else if (o.action === "delete") counts.deleted++;
    else counts.rejected++;
    errors.push(...(o.errors ?? []));
    warnings.push(...(o.warnings ?? []).map((w) => (w.startsWith(o.ref) ? w : `${o.ref}: ${w}`)));
    if (mode === "commit" && o.id_generated && o.id) assigned.push({ ref: o.ref, kind: o.kind, id: o.id });
  }
  const records =
    mode === "preview"
      ? plan.outcomes.map((o) => {
          if (!o.id_generated) return o;
          // Generated IDs are provisional in a preview; the real one is assigned on commit.
          const { id: _id, ...rest } = o;
          void _id;
          const record = rest.record ? { ...rest.record, id: null } : undefined;
          return { ...rest, id: null, record };
        })
      : plan.outcomes;
  if (plan.outcomes.length === 0) warnings.push("The import contained no records.");
  return {
    ok: true,
    mode,
    schema_version: SCHEMA_VERSION,
    counts,
    preview_token: plan.token,
    records,
    assigned_ids: assigned,
    errors,
    warnings,
  };
}

export async function previewImport(ownerId: string, payload: unknown): Promise<ImportReport | ImportFailure> {
  const parsed = parseEnvelope(payload);
  if (!parsed.ok) return { ok: false, status: 422, error: "The import was rejected as a whole.", errors: parsed.errors };
  const plan = await buildPlan(prisma, ownerId, parsed.envelope);
  return report(plan, "preview");
}

class StalePreview extends Error {
  constructor(readonly plan: Plan) {
    super("stale preview");
  }
}

/**
 * Re-validates and re-plans the payload inside one transaction, checks that
 * the plan still matches the confirmed preview, then applies every valid
 * record. Rejected records are reported, never partially written.
 */
export async function commitImport(
  ownerId: string,
  payload: unknown,
  previewToken: unknown,
): Promise<ImportReport | ImportFailure> {
  if (typeof previewToken !== "string" || !previewToken) {
    return {
      ok: false,
      status: 400,
      error: "preview_token is required. Preview the import and confirm it.",
      errors: [],
    };
  }
  const parsed = parseEnvelope(payload);
  if (!parsed.ok) return { ok: false, status: 422, error: "The import was rejected as a whole.", errors: parsed.errors };

  try {
    const plan = await prisma.$transaction(
      async (tx) => {
        // Serialise imports for this owner so two confirms cannot interleave.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId}, 0))`;
        const plan = await buildPlan(tx, ownerId, parsed.envelope);
        if (plan.token !== previewToken) throw new StalePreview(plan);
        await applyPlan(tx, ownerId, plan);
        return plan;
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
    return report(plan, "commit");
  } catch (e) {
    if (e instanceof StalePreview) {
      return {
        ok: false,
        status: 409,
        error: "Your data changed since the preview (or the payload differs). Review the new preview and confirm again.",
        errors: [],
        preview: report(e.plan, "preview"),
      };
    }
    throw e;
  }
}

/**
 * Plans and applies an envelope in one transaction, without a preview token.
 * For first-party forms (Settings) where submitting the form is the explicit
 * confirmation. All-or-nothing: if any record would be rejected, nothing is
 * written and the rejections are returned.
 */
export async function applyImportDirect(ownerId: string, payload: unknown): Promise<ImportReport | ImportFailure> {
  const parsed = parseEnvelope(payload);
  if (!parsed.ok) return { ok: false, status: 422, error: "Invalid settings.", errors: parsed.errors };
  const plan = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId}, 0))`;
      const plan = await buildPlan(tx, ownerId, parsed.envelope);
      if (!plan.outcomes.some((o) => o.action === "rejected")) await applyPlan(tx, ownerId, plan);
      return plan;
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
  const rejected = plan.outcomes.filter((o) => o.action === "rejected");
  if (rejected.length) {
    return { ok: false, status: 422, error: "Nothing was saved.", errors: rejected.flatMap((o) => o.errors ?? []) };
  }
  return report(plan, "commit");
}
