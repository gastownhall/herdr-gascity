import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NOTICES_FILE, noticesText } from "../../scripts/notices.ts";

const ROOT = join(import.meta.dir, "../..");

test("gascity/THIRD_PARTY_NOTICES.md carries every runtime dependency's license, fresh", async () => {
  const committed = await readFile(join(ROOT, NOTICES_FILE), "utf8").catch(() => "");
  expect(committed).toBe(await noticesText(ROOT));
  expect(committed).toContain("## zod 4.6.7 (MIT)");
  expect(committed).toContain("Copyright (c) 2025 Colin McDonnell");
});
