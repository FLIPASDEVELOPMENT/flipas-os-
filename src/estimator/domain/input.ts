import { z } from "zod";
export const moneyInput = z
  .string()
  .regex(
    /^\d{1,10}(\.\d{1,2})?$/,
    "Use a nonnegative USD amount with at most two decimals",
  );
export const ratioInput = z
  .string()
  .regex(/^(0(\.\d{1,4})?|1(\.0{1,4})?)$/, "Use a ratio between 0 and 1");
const text = z.string().trim().max(4000);
const date = z.union([z.iso.date(), z.literal("")]);
export const lineInput = z.object({
  snapshotId: z.string().max(100).optional(),
  serviceItemId: z.string().max(100).optional(),
  name: text.min(1).max(200),
  description: text,
  unit: z.enum(["EACH", "SQFT", "LINEAR_FT", "HOUR", "DAY", "FLAT"]),
  quantity: z.string().regex(/^\d{1,8}(\.\d{1,3})?$/),
  materialCost: moneyInput,
  laborCost: moneyInput,
  subcontractorCost: moneyInput,
  otherDirectCost: moneyInput,
  overheadAllocation: moneyInput,
  targetMargin: ratioInput.refine((v) => v.startsWith("0")),
  minimumMargin: ratioInput.refine((v) => v.startsWith("0")),
  overrideUnitPrice: z.union([moneyInput, z.literal("")]),
  overrideReason: text,
  taxable: z.boolean(),
});
export const sectionInput = z.object({
  name: text.min(1).max(200),
  lines: z.array(lineInput).max(100),
});
export const draftInput = z.object({
  id: z.string().optional(),
  contentVersion: z.number().int().nonnegative().default(0),
  customerId: z.string().min(1),
  opportunityId: z.string().optional(),
  category: text.min(1).max(100),
  projectAddress: text,
  scope: text,
  notes: text,
  inclusions: text,
  exclusions: text,
  durationDays: z.number().int().min(1).max(3650).nullable(),
  expiresAt: date,
  paymentSchedule: z
    .array(z.object({ label: text.min(1).max(150), percentage: ratioInput }))
    .max(12),
  discountRate: ratioInput,
  taxTreatment: z.enum(["UNREVIEWED", "EXEMPT", "TAXABLE"]),
  taxRate: ratioInput,
  sections: z.array(sectionInput).min(1).max(30),
});
export type LineInput = z.infer<typeof lineInput>;
export type DraftInput = z.infer<typeof draftInput>;
export const catalogInput = z.object({
  id: z.string().optional(),
  categoryId: z.string().min(1),
  name: text.min(1).max(200),
  description: text,
  unit: lineInput.shape.unit,
  materialCost: moneyInput,
  laborCost: moneyInput,
  subcontractorCost: moneyInput,
  otherDirectCost: moneyInput,
  overheadAllocation: moneyInput,
  targetMargin: ratioInput,
  minimumMargin: ratioInput,
  active: z.boolean(),
  effectiveFrom: z.iso.date(),
  effectiveTo: date,
  reason: text.min(1),
});
export const settingsInput = z.object({
  companyName: text.min(1).max(200),
  contactInfo: text,
  brandingColor: z.string().regex(/^#[\da-fA-F]{6}$/),
  terms: text,
  significantDiscountThreshold: ratioInput,
});
