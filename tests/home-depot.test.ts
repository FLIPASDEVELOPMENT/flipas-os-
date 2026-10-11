import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { previewCSV } from "../src/purchases/home-depot";
import { csvRows } from "../src/purchases/validation";
import { sample } from "./purchases.fixture";
export const homeDepotSample = () =>
  readFileSync(
    new URL(
      "../docs/examples/home-depot-pro-xtra-synthetic.csv",
      import.meta.url,
    ),
  );
function changed(change: (rows: string[][]) => void) {
  const rows = csvRows(homeDepotSample().toString());
  change(rows);
  return Buffer.from(
    rows
      .map((r) => r.map((v) => '"' + v.replaceAll('"', '""') + '"').join(","))
      .join("\n"),
  );
}
test("real Pro Xtra headers after metadata; job names, signs, net totals and distinct online movements", () => {
  const p = previewCSV(homeDepotSample());
  assert.equal(p.format, "HOME_DEPOT_PRO_XTRA_V1");
  assert.equal(p.validRows, 3);
  assert.equal(p.pendingRows, 2);
  assert.equal(p.rejected.length, 0);
  assert.equal(
    previewCSV(
      Buffer.from(homeDepotSample().toString().replaceAll("\n", "\r\n")),
    ).purchases.length,
    5,
  );
  const first = p.purchases[0];
  assert.equal(first.header.job_name, "SAMPLE-KITCHEN");
  assert.equal(first.native?.projectName, "Sample Kitchen");
  assert.equal(first.native?.otherDiscount, "-5.00");
  assert.equal(first.header.unit_price, "100.00");
  assert.equal(first.header.discount, "0.00");
  assert.equal(first.header.tax, "7.00");
  assert.equal(first.native?.dateBasis, "Receipt Added Date");
  assert.notEqual(p.purchases[1].sourceKey, p.purchases[2].sourceKey);
  assert.ok(p.warnings.some((w) => w.message.includes("distinct movements")));
  assert.ok(p.purchases[3].native!.blockedReasons.length);
  assert.equal(p.purchases[3].header.transaction_total, "-21.40");
  assert.ok(
    p.purchases[3].native!.blockedReasons.some((w) =>
      w.includes("same transaction identity"),
    ),
  );
  assert.equal(JSON.stringify(first).includes("Test buyer"), false);
});
test("exact repeats are warnings; changed same identity stays blocked; normalized CSV still works", () => {
  const repeat = previewCSV(changed((r) => r.push(r[7])));
  assert.equal(repeat.duplicateRows, 1);
  assert.equal(repeat.purchases.length, 5);
  const differentPayment = previewCSV(
    changed((r) => {
      const a = [...r[7]];
      a[13] = "Different synthetic payment";
      r.push(a);
    }),
  );
  assert.equal(differentPayment.duplicateRows, 0);
  assert.equal(differentPayment.purchases.length, 6);
  assert.ok(
    differentPayment.purchases[0].native!.blockedReasons.some((w) =>
      w.includes("same transaction identity"),
    ),
  );
  const ambiguous = previewCSV(
    changed((r) => {
      const a = [...r[7]];
      a[10] = "$101.00";
      a[11] = "$108.07";
      r.push(a);
    }),
  );
  assert.ok(
    ambiguous.purchases[0].native!.blockedReasons.some((w) =>
      w.includes("same transaction identity"),
    ),
  );
  assert.equal(previewCSV(sample()).format, "NORMALIZED");
  assert.equal(previewCSV(changed((r) => r.reverse())).purchases.length, 0);
});
test("malformed rows are rejected without losing valid transactions; financial ambiguity is retained blocked", () => {
  const invalid = previewCSV(
    changed((r) => {
      r[7][10] = "NaN";
      r[8][1] = "bad date";
    }),
  );
  assert.equal(invalid.rejected.length, 2);
  assert.equal(invalid.purchases.length, 3);
  const tax = previewCSV(
    changed((r) => {
      r[7][11] = "$90.00";
    }),
  );
  assert.ok(
    tax.purchases[0].native!.blockedReasons.some((w) =>
      w.includes("below pre-tax"),
    ),
  );
  const commas = previewCSV(
    changed((r) => {
      r[7][10] = "$1,000.00";
      r[7][11] = "$1,070.00";
    }),
  );
  assert.equal(commas.purchases[0].header.tax, "70.00");
  assert.throws(() => previewCSV(Buffer.from('"unterminated')));
  assert.throws(() => previewCSV(Buffer.alloc(1048577)));
  assert.throws(
    () =>
      previewCSV(
        changed((r) => {
          for (let i = 0; i < 501; i++) r.push(r[7]);
        }),
      ),
    /CSV_COLUMNS/,
  );
});
