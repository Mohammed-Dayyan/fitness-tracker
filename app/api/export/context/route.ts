import { buildContextPackage } from "@/lib/server/export";
import { withOwner } from "@/lib/server/http";

/** Plain-text prompt to paste into a new ChatGPT conversation. */
export const GET = withOwner(async (_req, { ownerId }) => {
  const text = await buildContextPackage(ownerId);
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
});
