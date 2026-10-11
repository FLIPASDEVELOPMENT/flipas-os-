import { z } from "zod";
import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import { categories } from "./categories";
export const amount = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,2})?$/)
  .transform((v) => new Decimal(v).toFixed(2));
export const allocationsInput = z
  .array(
    z
      .object({
        lineId: z.string().min(1).max(80),
        amount,
        category: z.enum(categories),
        costType: z.enum(["MATERIAL", "LABOR", "SUBCONTRACTOR", "OTHER"]),
        projectId: z.string().min(1).optional(),
        estimateLineId: z.string().min(1).optional(),
        existingLedgerId: z.string().min(1).optional(),
      })
      .strict(),
  )
  .min(1)
  .max(500);
export type Allocations = z.infer<typeof allocationsInput>;
export const columns = [
  "source",
  "external_id",
  "vendor",
  "date",
  "receipt_id",
  "po_number",
  "job_name",
  "store",
  "currency",
  "line_id",
  "sku",
  "description",
  "quantity",
  "unit_price",
  "tax",
  "discount",
  "line_total",
  "transaction_total",
];
export function digest(v: string | Buffer) {
  return createHash("sha256").update(v).digest("hex");
}
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += c;
    } else if (c === '"') {
      if (value || closed) throw new Error("INVALID_CSV");
      quoted = true;
    } else if (c === "," || c === "\n" || c === "\r") {
      row.push(value);
      value = "";
      closed = false;
      if (c !== ",") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        if (row.some((v) => v !== "")) rows.push(row);
        row = [];
      }
    } else {
      if (closed) throw new Error("INVALID_CSV");
      value += c;
    }
  }
  if (quoted) throw new Error("INVALID_CSV");
  row.push(value);
  if (row.some((v) => v !== "")) rows.push(row);
  return rows;
}
const short = z.string().trim().max(200),
  required = short.min(1);
const rowInput = z.object({
  source: z.enum([
    "MANUAL_CSV",
    "HOME_DEPOT_CSV",
    "LOWES_CSV",
    "QUICKBOOKS_CSV",
  ]),
  external_id: required,
  vendor: required,
  date: z.iso.date(),
  receipt_id: required,
  po_number: short,
  job_name: short,
  store: short,
  currency: z.literal("USD"),
  line_id: required,
  sku: short,
  description: z.string().trim().min(1).max(1000),
  quantity: z
    .string()
    .regex(/^\d{1,8}(\.\d{1,4})?$/)
    .refine((v) => new Decimal(v).gt(0)),
  unit_price: amount,
  tax: amount,
  discount: amount,
  line_total: amount,
  transaction_total: amount,
});
export function parsePurchases(data: Buffer) {
  if (data.length === 0 || data.length > 1048576) throw new Error("FILE_LIMIT");
  const text = new TextDecoder("utf-8", { fatal: true })
    .decode(data)
    .replace(/^\uFEFF/, "");
  if (text.includes("\0")) throw new Error("INVALID_CSV");
  const rows = csvRows(text),
    header = rows.shift();
  if (
    !header ||
    JSON.stringify(header) !== JSON.stringify(columns) ||
    !rows.length ||
    rows.length > 500
  )
    throw new Error("CSV_COLUMNS");
  const groups = new Map<
    string,
    {
      sourceKey: string;
      evidenceKey: string;
      header: z.infer<typeof rowInput>;
      lines: z.infer<typeof rowInput>[];
    }
  >();
  for (const values of rows) {
    if (values.length !== columns.length) throw new Error("CSV_COLUMNS");
    const r = rowInput.parse(
      Object.fromEntries(columns.map((c, i) => [c, values[i]])),
    );
    const computed = new Decimal(r.quantity)
      .mul(r.unit_price)
      .toDecimalPlaces(2)
      .add(r.tax)
      .sub(r.discount);
    if (computed.lt(0) || !computed.eq(r.line_total))
      throw new Error("TOTAL_MISMATCH");
    const sourceKey = digest(
      JSON.stringify([r.source, r.vendor.toLowerCase(), r.external_id]),
    );
    const evidenceKey = digest(
      JSON.stringify([
        r.vendor.toLowerCase(),
        r.receipt_id.toLowerCase(),
        r.date,
        r.currency,
      ]),
    );
    let group = groups.get(sourceKey);
    if (!group) {
      group = { sourceKey, evidenceKey, header: r, lines: [] };
      groups.set(sourceKey, group);
    }
    for (const c of [
      "vendor",
      "date",
      "receipt_id",
      "po_number",
      "job_name",
      "store",
      "currency",
      "transaction_total",
    ] as const)
      if (group.header[c] !== r[c]) throw new Error("CONFLICTING_TRANSACTION");
    if (group.lines.some((l) => l.line_id === r.line_id))
      throw new Error("DUPLICATE_LINE");
    group.lines.push(r);
  }
  for (const g of groups.values())
    if (
      !g.lines
        .reduce((a, l) => a.add(l.line_total), new Decimal(0))
        .eq(g.header.transaction_total)
    )
      throw new Error("TOTAL_MISMATCH");
  return [...groups.values()];
}
export type PurchaseData = ReturnType<typeof parsePurchases>[number];
export function validateDistribution(p: PurchaseData, input: unknown) {
  const allocations = allocationsInput.parse(input);
  for (const a of allocations)
    if (
      !p.lines.some((l) => l.line_id === a.lineId) ||
      (!a.projectId &&
        (a.estimateLineId ||
          a.existingLedgerId ||
          a.category !== "General Overhead"))
    )
      throw new Error("ALLOCATION_LINK");
  for (const line of p.lines)
    if (
      !allocations
        .filter((a) => a.lineId === line.line_id)
        .reduce((v, a) => v.add(a.amount), new Decimal(0))
        .eq(line.line_total)
    )
      throw new Error("ALLOCATION_TOTAL");
  return allocations;
}
