import { NextResponse } from "next/server";
import { jsonError, readJsonBody, requireJsonContentType, withOwner } from "@/lib/server/http";
import { getDayContext } from "@/lib/server/day";
import { saveProfile, saveSteps, saveTargets, saveWeighIn } from "@/lib/server/settings";

/**
 * POST { "section": "profile" | "weight" | "steps" | "targets", ...fields }.
 * Writes go through the import engine (same validation and history rules).
 */
export const POST = withOwner(async (req, { ownerId }) => {
  if (!requireJsonContentType(req)) return jsonError(415, "Expected application/json.");
  const body = await readJsonBody(req, 16 * 1024);
  if (!body.ok) return jsonError(body.status, body.error);
  const value = (body.value ?? {}) as Record<string, unknown>;

  const today = () => getDayContext(ownerId).then((c) => c.today);
  const result =
    value.section === "profile"
      ? await saveProfile(ownerId, value, await today())
      : value.section === "weight"
        ? await saveWeighIn(ownerId, value, await today())
        : value.section === "steps"
          ? await saveSteps(ownerId, value, await today())
          : value.section === "targets"
            ? await saveTargets(ownerId, value)
            : null;
  if (!result) return jsonError(400, 'section must be "profile", "weight", "steps" or "targets".');
  return result.ok
    ? NextResponse.json(result)
    : NextResponse.json(result, { status: 422 });
});
