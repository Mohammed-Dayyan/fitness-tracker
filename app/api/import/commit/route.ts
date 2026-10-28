import { NextResponse } from "next/server";
import { commitImport } from "@/lib/server/import";
import { COMMIT_WRAPPER_BYTES, MAX_IMPORT_BYTES } from "@/lib/shared/limits";
import { jsonError, readJsonBody, requireJsonContentType, withOwner } from "@/lib/server/http";

/**
 * Body: { "payload": <import envelope>, "preview_token": "<from preview>" }.
 * The payload is re-validated and re-planned server-side; nothing from the
 * preview response is trusted except the token used to detect staleness.
 */
export const POST = withOwner(async (req, { ownerId }) => {
  if (!requireJsonContentType(req)) return jsonError(415, "Expected application/json.");
  const body = await readJsonBody(req, MAX_IMPORT_BYTES + COMMIT_WRAPPER_BYTES);
  if (!body.ok) return jsonError(body.status, body.error);
  const value = body.value as { payload?: unknown; preview_token?: unknown } | null;
  if (!value || typeof value !== "object" || !("payload" in value)) {
    return jsonError(400, 'Expected { "payload": ..., "preview_token": ... }.');
  }

  const result = await commitImport(ownerId, value.payload, value.preview_token);
  if (!result.ok) {
    return jsonError(result.status, result.error, { errors: result.errors, preview: result.preview });
  }
  return NextResponse.json(result);
});
