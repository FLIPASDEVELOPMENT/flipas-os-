import "dotenv/config";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
const source = process.env.DATABASE_URL;
if (!source)
  throw new Error(
    "DATABASE_URL must be configured privately before running tests.",
  );
const url = new URL(source),
  name = `operations_${Date.now()}_${randomBytes(4).toString("hex")}_test`,
  user = decodeURIComponent(url.username);
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { env, stdio: "inherit" });
  if (result.status !== 0)
    throw new Error(
      "Validation command failed; test database cleanup will run.",
    );
}
let created = false;
try {
  run("docker", ["compose", "exec", "-T", "db", "createdb", "-U", user, name]);
  created = true;
  url.pathname = "/" + name;
  const env = {
    ...process.env,
    DATABASE_URL: url.toString(),
    ZOHO_SEND_ENABLED: "false",
  };
  run("npm", ["run", "db:migrate"], env);
  run("npm", ["run", "test:operations"], env);
} finally {
  if (created)
    run("docker", ["compose", "exec", "-T", "db", "dropdb", "-U", user, name]);
}
