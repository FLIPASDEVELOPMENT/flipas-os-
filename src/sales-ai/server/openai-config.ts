import { z } from "zod";
const rate = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/)
  .refine((v) => Number(v) > 0 && Number(v) <= 1000);
const schema = z.object({
  key: z.string().min(1).max(2000),
  model: z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/),
  inputRate: rate,
  outputRate: rate,
  verifiedAt: z.iso.date(),
});
/** Private server environment only. Never serialize this object into a page or log. */
export function openaiConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const result = schema.safeParse({
    key: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    inputRate: env.OPENAI_INPUT_USD_PER_MILLION,
    outputRate: env.OPENAI_OUTPUT_USD_PER_MILLION,
    verifiedAt: env.OPENAI_PRICING_VERIFIED_AT,
  });
  if (!result.success) throw new Error("AI_CONFIG_REQUIRED");
  return result.data;
}
export function openaiStatus() {
  try {
    const c = openaiConfig();
    return {
      configured: true,
      model: c.model,
      inputRate: c.inputRate,
      outputRate: c.outputRate,
      verifiedAt: c.verifiedAt,
    };
  } catch {
    return {
      configured: false,
      model: "",
      inputRate: "",
      outputRate: "",
      verifiedAt: "",
    };
  }
}
