import { readFile, writeFile, chmod } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
if (!process.stdin.isTTY || !process.stdout.isTTY)
  throw new Error("Run this command in your own interactive Terminal.");
execFileSync("git", ["check-ignore", "--quiet", ".env"]);
let hidden = false;
const maskedOutput = new Writable({
  write(chunk, _encoding, done) {
    if (!hidden) process.stdout.write(chunk);
    done();
  },
});
const terminal = createInterface({
  input: process.stdin,
  output: maskedOutput,
  terminal: true,
});
try {
  console.log(
    "Check the model and standard token prices on developers.openai.com first. No API call will be made.",
  );
  const model = (await terminal.question("Verified model ID: ")).trim();
  const input = (
    await terminal.question("USD per million input tokens: ")
  ).trim();
  const output = (
    await terminal.question("USD per million output tokens: ")
  ).trim();
  if (
    !/^[a-zA-Z0-9._-]{1,100}$/.test(model) ||
    ![input, output].every(
      (v) => /^\d+(\.\d{1,6})?$/.test(v) && Number(v) > 0 && Number(v) <= 1000,
    )
  )
    throw new Error("Check model ID and positive standard prices.");
  const current = await readFile(".env", "utf8");
  process.stdout.write(
    "API key (hidden; paste here in Terminal, never in chat): ",
  );
  hidden = true;
  const key = (await terminal.question("")).trim();
  hidden = false;
  process.stdout.write("\n");
  if (!key || key.length > 2000 || /[\s"'\\]/.test(key))
    throw new Error("Invalid key format. Nothing saved.");
  const values = {
    OPENAI_API_KEY: key,
    OPENAI_MODEL: model,
    OPENAI_INPUT_USD_PER_MILLION: input,
    OPENAI_OUTPUT_USD_PER_MILLION: output,
    OPENAI_PRICING_VERIFIED_AT: new Date().toISOString().slice(0, 10),
  };
  let text = current;
  for (const [name, value] of Object.entries(values)) {
    text = text.replace(new RegExp("^" + name + "=.*(?:\\r?\\n|$)", "gm"), "");
    text += "\n" + name + "=" + value + "\n";
  }
  await writeFile(".env", text, { mode: 0o600 });
  await chmod(".env", 0o600);
  console.log(
    "Private server configuration saved to ignored .env. No requests sent. Restart app and worker.",
  );
} catch {
  console.error(
    "Configuration not completed. Verify your entries and that .env is ignored. Never share its contents.",
  );
  process.exitCode = 1;
} finally {
  terminal.close();
}
