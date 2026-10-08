import { cp, mkdir, readdir, rm } from "node:fs/promises";
// Next traces root environment files into standalone output. Never ship them.
// The original project .env remains private and untouched; inject runtime env.
for (const name of await readdir(".next/standalone")) {
  if (name === ".env" || name.startsWith(".env."))
    await rm(`.next/standalone/${name}`, { force: true });
}
await mkdir(".next/standalone/.next", { recursive: true });
await cp(".next/static", ".next/standalone/.next/static", { recursive: true });
