import "dotenv/config";
import { workerTick } from "../src/sales-ai/server/jobs";
import { db } from "../src/server/db";
async function main() {
  if (process.argv.includes("--once")) {
    await workerTick();
    await db.$disconnect();
    return;
  }
  let running = true;
  process.on("SIGTERM", () => {
    running = false;
  });
  process.on("SIGINT", () => {
    running = false;
  });
  while (running) {
    try {
      await workerTick();
    } catch {
      console.error("Worker tick failed; inspect database job status.");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  await db.$disconnect();
}
main().catch(() => {
  console.error("Worker startup failed; check configuration.");
  process.exitCode = 1;
});
