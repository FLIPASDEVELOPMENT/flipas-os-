import { z } from "zod";
import Decimal from "decimal.js";
import { LeadSource, LeadStatus, Stage } from "../domain/stages";
const text = z.string().trim().max(2000);
const optional = text.transform((v) => v || null);
export const customerInput = z.object({
  firstName: text.min(1).max(100),
  lastName: text.min(1).max(100),
  email: z.union([z.email(), z.literal("")]).transform((v) => v || null),
  phone: optional,
  address: optional,
  city: optional,
  state: z.string().trim().length(2),
  zip: optional,
  notes: optional,
});
const money = z
  .string()
  .regex(/^(?:\d{1,10}(?:\.\d{1,2})?)?$/)
  .transform((v) => v || null);
export const leadInput = z
  .object({
    customerId: z.string().min(1),
    source: z.enum(LeadSource),
    serviceType: text.min(1).max(100),
    description: optional,
    status: z.enum(LeadStatus),
    leadScore: z.coerce.number().int().min(0).max(100),
    budgetMin: money,
    budgetMax: money,
    desiredStartDate: z
      .union([z.iso.date(), z.literal("")])
      .transform((v) => (v ? new Date(v) : null))
      .refine((v) => !v || !Number.isNaN(v.getTime()), "Invalid date"),
    assignedToId: optional,
  })
  .refine(
    (v) =>
      !v.budgetMin ||
      !v.budgetMax ||
      new Decimal(v.budgetMin).lte(v.budgetMax),
    "Budget minimum exceeds maximum",
  );
export const opportunityInput = z.object({
  leadId: z.string().min(1),
  estimatedValue: money,
  probability: z.coerce.number().int().min(0).max(100),
  nextAction: optional,
  nextActionDate: z
    .union([z.iso.date(), z.literal("")])
    .transform((v) => (v ? new Date(v) : null))
    .refine((v) => !v || !Number.isNaN(v.getTime()), "Invalid date"),
});
export const stageInput = z.object({
  id: z.string().min(1),
  stage: z.enum(Stage),
});
export const noteInput = z.object({
  leadId: z.string().min(1),
  message: text.min(1),
});
export function formData(form: FormData) {
  return Object.fromEntries(form.entries());
}
