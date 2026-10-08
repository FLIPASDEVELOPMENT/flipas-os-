import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("standalone packaging removes traced env files without touching private configuration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flipas-artifact-"));
  try {
    await mkdir(join(dir, ".next/standalone"), { recursive: true });
    await mkdir(join(dir, ".next/static"), { recursive: true });
    await writeFile(join(dir, ".env"), "PRIVATE_CONFIG=fixture");
    for (const name of [".env", ".env.local", ".env.production"])
      await writeFile(join(dir, ".next/standalone", name), "PRIVATE_CONFIG=fixture");
    await writeFile(join(dir, ".next/static/asset.txt"), "static");
    const result = spawnSync(process.execPath, [resolve("scripts/copy-static.mjs")], { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.ok(!(await readdir(join(dir, ".next/standalone"))).some(n => n.startsWith(".env")));
    assert.equal(await readFile(join(dir, ".env"), "utf8"), "PRIVATE_CONFIG=fixture");
    assert.equal(await readFile(join(dir, ".next/standalone/.next/static/asset.txt"), "utf8"), "static");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
