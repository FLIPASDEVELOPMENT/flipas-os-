import { getGenerators } from "@prisma/internals";
import { PrismaClientTsGenerator } from "@prisma/client-generator-ts";
async function main() {
  const generators = await getGenerators({
    schemaPath: "prisma/schema.prisma",
    registry: {
      "prisma-client": {
        type: "in-process",
        generator: new PrismaClientTsGenerator(),
      },
    },
    skipDownload: true,
    cliCommand: "generate",
  });
  try {
    for (const generator of generators) await generator.generate();
  } finally {
    for (const generator of generators) generator.stop();
  }
  console.log(
    "Prisma client generated using verified npm-packaged WASM tooling",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
