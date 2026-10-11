import Decimal from "decimal.js";
import { z } from "zod";
import {
  csvRows,
  digest,
  parsePurchases,
  type PurchaseData,
} from "./validation";

export type ImportIssue = { row: number; message: string };
export type ImportPreview = {
  format: "NORMALIZED" | "HOME_DEPOT_PRO_XTRA_V1";
  purchases: PurchaseData[];
  validRows: number;
  pendingRows: number;
  duplicateRows: number;
  rejected: ImportIssue[];
  warnings: ImportIssue[];
};
const requiredHeaders = [
  "Transaction ID",
  "Job Name",
  "Order Number",
  "Pre-tax Amount",
  "Total Amount Paid",
  "Receipt Added Date",
];
function money(value: string, optional = false) {
  let v = value.trim();
  if (!v && optional) return "0.00";
  if (/^\(.*\)$/.test(v)) v = "-" + v.slice(1, -1);
  v = v.replace(/^(-?)\$/, "$1");
  if (!/^-?(?:\d{1,10}|\d{1,3}(?:,\d{3}){1,3})(?:\.\d{1,2})?$/.test(v))
    throw new Error("Invalid USD amount");
  const n = new Decimal(v.replaceAll(",", ""));
  if (n.abs().gte("10000000000")) throw new Error("Amount exceeds limit");
  return n.toFixed(2);
}
function bounded(value: string, max = 200) {
  if (value.length > max || value.includes("\0"))
    throw new Error("Field exceeds limit");
  return value;
}
export function previewCSV(data: Buffer): ImportPreview {
  if (!data.length || data.length > 1048576) throw new Error("FILE_LIMIT");
  const text = new TextDecoder("utf-8", { fatal: true })
    .decode(data)
    .replace(/^\uFEFF/, "");
  if (text.includes("\0")) throw new Error("INVALID_CSV");
  const rows = csvRows(text);
  const index = rows.findIndex((r) =>
    requiredHeaders.every((h) => r.includes(h)),
  );
  if (index === -1) {
    const purchases = parsePurchases(data);
    return {
      format: "NORMALIZED",
      purchases,
      validRows: purchases.reduce((n, p) => n + p.lines.length, 0),
      pendingRows: 0,
      duplicateRows: 0,
      rejected: [],
      warnings: [],
    };
  }
  const header = rows[index];
  if (
    new Set(header).size !== header.length ||
    !rows.length ||
    rows.length - index - 1 > 500
  )
    throw new Error("CSV_COLUMNS");
  const result: ImportPreview = {
    format: "HOME_DEPOT_PRO_XTRA_V1",
    purchases: [],
    validRows: 0,
    pendingRows: 0,
    duplicateRows: 0,
    rejected: [],
    warnings: [],
  };
  const seen = new Set<string>(),
    identities = new Map<string, PurchaseData[]>(),
    orders = new Map<string, number>();
  for (let i = index + 1; i < rows.length; i++) {
    const row = i + 1;
    try {
      if (rows[i].length !== header.length)
        throw new Error("Column count does not match header");
      const r = Object.fromEntries(
        header.map((h, j) => [h, rows[i][j].trim()]),
      );
      // Payment, purchaser and account nicknames are deliberately excluded from normalized data.
      const tx = bounded(r["Transaction ID"]),
        dateValue = r.Date || r["Receipt Added Date"];
      if (!tx) throw new Error("Missing transaction ID");
      const date = z.iso.date().parse(dateValue);
      const store = bounded(r["Order Origin"] || ""),
        register = bounded(r["Register Number"] || "");
      const order = bounded(r["Order Number"] || ""),
        invoice = bounded(r["Invoice Number"] || "");
      const projectName = bounded(r["Project Name"] || ""),
        jobName = bounded(r["Job Name"] || "");
      const pretax = money(r["Pre-tax Amount"]),
        paid = money(r["Total Amount Paid"]);
      const programDiscount = money(r["Program Disc Amt"] || "", true),
        otherDiscount = money(r["Other Disc"] || "", true);
      const tax = new Decimal(paid).sub(pretax).toFixed(2);
      const blockedReasons: string[] = [],
        warnings = [
          "Transaction summary only: item descriptions, SKUs and quantities are not supplied.",
          "Tax is the reported paid total minus reported pre-tax amount; no tax rate is assumed. Reported discounts are preserved separately, not applied twice.",
        ];
      if (!r.Date)
        warnings.push(
          "Purchase Date is empty. Receipt Added Date is shown instead; verify the actual purchase date before approval.",
        );
      if (new Decimal(paid).lte(0) || new Decimal(pretax).lte(0))
        blockedReasons.push(
          "Return, credit or zero-value movement: retained pending; cost recognition is not supported.",
        );
      if (new Decimal(paid).gt(0) && new Decimal(tax).lt(0))
        blockedReasons.push(
          "Paid total is below pre-tax amount; tax/adjustment requires verification.",
        );
      if (
        new Decimal(programDiscount).gt(0) ||
        new Decimal(otherDiscount).gt(0)
      )
        blockedReasons.push(
          "Unexpected positive discount sign; verify this export before cost recognition.",
        );
      const description = bounded(
        r.Description ||
          r["Product Description"] ||
          "Home Depot transaction summary — item details not provided",
        1000,
      );
      if (
        [
          "SKU",
          "Quantity",
          "Unit Price",
          "Description",
          "Product Description",
        ].some((h) => header.includes(h))
      )
        blockedReasons.push(
          "Itemized export variant requires a separate verified adapter; this transaction summary cannot recognize costs.",
        );
      const receipt =
        "HD-" +
        digest(
          JSON.stringify([
            date,
            store.toLowerCase(),
            register,
            tx,
            order,
            invoice,
          ]),
        ).slice(0, 32);
      const fingerprint = digest(
        // Only an entire repeated row is skipped. Payment/purchaser differences
        // may distinguish movements, but their values stay in private original evidence.
        JSON.stringify(
          Object.entries(r).sort(([a], [b]) => a.localeCompare(b)),
        ),
      );
      if (seen.has(fingerprint)) {
        result.duplicateRows++;
        result.warnings.push({
          row,
          message:
            "Exact repeated transaction summary skipped; no item details exist in this export.",
        });
        continue;
      }
      seen.add(fingerprint);
      const identity = digest(
        JSON.stringify(["home depot", receipt.toLowerCase(), date, "USD"]),
      );
      const normalized = {
        source: "HOME_DEPOT_CSV" as const,
        external_id: receipt + ":" + fingerprint.slice(0, 24),
        vendor: "Home Depot",
        date,
        receipt_id: receipt,
        po_number: order,
        job_name: jobName || projectName,
        store,
        currency: "USD" as const,
        line_id: "summary",
        sku: "",
        description,
        quantity: "1",
        unit_price: pretax,
        tax,
        discount: "0.00",
        line_total: paid,
        transaction_total: paid,
      };
      const p: PurchaseData = {
        sourceKey: digest(
          JSON.stringify([
            normalized.source,
            "home depot",
            normalized.external_id,
          ]),
        ),
        evidenceKey: identity,
        header: normalized,
        lines: [normalized],
        native: {
          adapter: "HOME_DEPOT_PRO_XTRA_V1",
          transactionId: tx,
          projectName,
          jobName,
          orderNumber: order,
          invoiceNumber: invoice,
          dateBasis: r.Date ? "Date" : "Receipt Added Date",
          programDiscount,
          otherDiscount,
          warnings,
          blockedReasons,
        },
      };
      result.purchases.push(p);
      identities.set(identity, [...(identities.get(identity) || []), p]);
      if (order) orders.set(order, (orders.get(order) || 0) + 1);
      for (const message of warnings) result.warnings.push({ row, message });
    } catch {
      result.rejected.push({
        row,
        message:
          "Invalid row: check column count, required transaction ID, ISO date and signed USD amounts. No cost will be recorded.",
      });
    }
  }
  for (const group of identities.values())
    if (group.length > 1)
      for (const p of group)
        p.native!.blockedReasons.push(
          "Different movements share the same transaction identity. No automatic grouping or cost recognition; verify original receipt.",
        );
  for (const [order, count] of orders)
    if (count > 1)
      result.warnings.push({
        row: 0,
        message: `Order ${order} contains ${count} distinct movements. They remain separate; an order number alone does not prove duplication.`,
      });
  result.pendingRows = result.purchases.filter(
    (p) => p.native!.blockedReasons.length > 0,
  ).length;
  result.validRows = result.purchases.length - result.pendingRows;
  return result;
}
