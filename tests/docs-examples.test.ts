import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createBareOwner, importOk } from "./helpers/factory";

/** JSON code blocks from a markdown file, skipping illustrative ones with "…". */
function jsonBlocks(path: string): unknown[] {
  const md = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  return [...md.matchAll(/```json\n([\s\S]*?)```/g)]
    .map((m) => m[1])
    .filter((block) => !block.includes("…"))
    .map((block) => JSON.parse(block));
}

describe("documentation examples are valid imports", () => {
  for (const doc of ["docs/setup.md", "docs/user-guide.md"]) {
    it(`${doc}: every example imports with no rejected records`, async () => {
      const owner = await createBareOwner("docs");
      const blocks = jsonBlocks(doc);
      expect(blocks.length).toBeGreaterThan(0);
      // Run in document order: later examples correct, move or extend earlier ones.
      for (const block of blocks) {
        const res = await importOk(owner, block);
        expect(res.errors, JSON.stringify(block)).toEqual([]);
      }
    });
  }
});
