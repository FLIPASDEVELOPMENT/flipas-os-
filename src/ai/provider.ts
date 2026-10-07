import { z } from "zod";
export interface AIProvider {
  generate(prompt: string): Promise<string>;
  analyze(context: unknown): Promise<{ summary: string }>;
  classify(text: string, labels: string[]): Promise<string>;
  extractStructuredData<T>(text: string, schema: z.ZodType<T>): Promise<T>;
}
// Provider implementations and action execution are intentionally deferred to Phase 2.
