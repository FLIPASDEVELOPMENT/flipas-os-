import "dotenv/config";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { bindMigrationAwareSqlAdapterFactory } from "@prisma/driver-adapter-utils";
import { createRequire } from "node:module";
import * as runtime from "@prisma/schema-engine-wasm/schema_engine_bg";
// PostgreSQL must parse the entire script: splitting on semicolons breaks dollar-quoted functions.
class MigrationAdapter extends PrismaPg {
  async connect() {
    const adapter = await super.connect();
    adapter.executeScript = async (sql: string) => {
      await adapter.executeRaw({ sql, args: [], argTypes: [] });
    };
    return adapter;
  }
}
async function loadEngine(content: string) {
  const require = createRequire(import.meta.url);
  const bytes = await readFile(
    require
      .resolve("@prisma/schema-engine-wasm/schema_engine_bg")
      .replace(/\.js$/, ".wasm"),
  );
  const wasmModule = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(wasmModule, {
    "./schema_engine_bg.js": runtime,
  });
  runtime.__wbg_set_wasm(instance.exports);
  (instance.exports.__wbindgen_start as () => void)();
  return runtime.SchemaEngine.new(
    { datamodels: [["schema.prisma", content]] },
    () => {},
    bindMigrationAwareSqlAdapterFactory(
      new MigrationAdapter({ connectionString: process.env.DATABASE_URL }),
    ),
  );
}
async function main() {
  const content = await readFile("prisma/schema.prisma", "utf8");
  const engine = await loadEngine(content);
  const filters = { externalTables: [], externalEnums: [] };
  try {
    if (process.argv.includes("--initial")) {
      const result = await engine.diff({
        from: { tag: "empty" },
        to: {
          tag: "schemaDatamodel",
          files: [{ path: "schema.prisma", content }],
        },
        script: true,
        exitCode: false,
        filters,
      });
      if (!result.stdout) throw new Error("No migration script generated");
      await writeFile(
        "prisma/migrations/202610070001_initial/migration.sql",
        result.stdout,
      );
      console.log("Initial SQL migration generated");
      return;
    }
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    const baseDir = resolve("prisma/migrations");
    const dirs = (await readdir(baseDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    const migrationDirectories = await Promise.all(
      dirs.map(async (path) => ({
        path,
        migrationFile: {
          path: "migration.sql",
          content: {
            tag: "ok" as const,
            value: await readFile(`${baseDir}/${path}/migration.sql`, "utf8"),
          },
        },
      })),
    );
    const result = await engine.applyMigrations({
      migrationsList: {
        baseDir,
        lockfile: {
          path: "migration_lock.toml",
          content: await readFile(`${baseDir}/migration_lock.toml`, "utf8"),
        },
        shadowDbInitScript: "",
        migrationDirectories,
      },
      filters,
    });
    console.log(result);
  } finally {
    engine[Symbol.dispose]();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
