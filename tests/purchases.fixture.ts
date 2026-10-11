import { columns } from "../src/purchases/validation";
export function sample(overrides: Record<string, string> = {}) {
  const row = {
    source: "MANUAL_CSV",
    external_id: "external-1",
    vendor: "Test vendor",
    date: "2026-10-11",
    receipt_id: "receipt-1",
    po_number: "",
    job_name: "Test kitchen",
    store: "",
    currency: "USD",
    line_id: "1",
    sku: "SKU-1",
    description: "Purchase private financial sentinel",
    quantity: "2",
    unit_price: "20.00",
    tax: "2.80",
    discount: "2.00",
    line_total: "40.80",
    transaction_total: "40.80",
    ...overrides,
  };
  const quote = (v: string) => '"' + v.replaceAll('"', '""') + '"';
  return Buffer.from(
    columns.join(",") +
      "\n" +
      columns.map((c) => quote(row[c as keyof typeof row])).join(",") +
      "\n",
  );
}
