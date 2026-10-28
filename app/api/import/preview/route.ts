import { NextResponse } from "next/server";
import { previewImport } from "@/lib/server/import";
import { MAX_IMPORT_BYTES } from "@/lib/shared/limits";
import { jsonError, readJsonBody, requireJsonContentType, withOwner } from "@/lib/server/http";

/** Body: the import envelope. Validates and plans without writing anything. */
export const POST = withOwner(async (req, { ownerId }) => {
  if (!requireJsonContentType(req)) return jsonError(415, "Expected application/json.");
  const body = await readJsonBody(req, MAX_IMPORT_BYTES);
  if (!body.ok) return jsonError(body.status, body.error);

  const result = await previewImport(ownerId, body.value);
  if (!result.ok) return jsonError(result.status, result.error, { errors: result.errors });
  return NextResponse.json(result);
});
