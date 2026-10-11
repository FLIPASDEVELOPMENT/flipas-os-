import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePurchases,
  validateDistribution,
  csvRows,
} from "../src/purchases/validation";
import { sample } from "./purchases.fixture";
test("CSV normalizes precise amounts and preserves escaped untrusted descriptions", () => {
  const p = parsePurchases(
    sample({ description: 'Tile, "quoted"\nand newline' }),
  )[0];
  assert.equal(p.lines[0].line_total, "40.80");
  assert.equal(p.lines[0].description, 'Tile, "quoted"\nand newline');
  assert.equal(p.header.job_name, "Test kitchen");
  assert.equal(csvRows('a,b\r\n"a,b",c\r\n').length, 2);
});
test("CSV rejects malformed, unsupported, excessive and unbalanced input atomically", () => {
  for (const data of [
    Buffer.from("wrong,header\n1,2"),
    sample({ line_total: "40.81" }),
    sample({ transaction_total: "40.81" }),
    sample({ quantity: "0" }),
    sample({ tax: "NaN" }),
    sample({ currency: "EUR" }),
    sample({ unit_price: "-20" }),
    Buffer.from('"unfinished'),
    Buffer.alloc(1048577),
    Buffer.from([0xff]),
  ])
    assert.throws(() => parsePurchases(data));
});
test("allocation splits balance each line and reject cross-line or overhead mismatches", () => {
  const p = parsePurchases(sample())[0];
  const a = {
    lineId: "1",
    amount: "20.40",
    category: "Tile",
    costType: "MATERIAL",
    projectId: "project-1",
  };
  assert.equal(
    validateDistribution(p, [a, { ...a, projectId: "project-2" }]).length,
    2,
  );
  assert.throws(() => validateDistribution(p, [a]));
  assert.throws(() =>
    validateDistribution(p, [{ ...a, lineId: "fake", amount: "40.80" }]),
  );
  assert.throws(() =>
    validateDistribution(p, [{ ...a, amount: "40.80", projectId: undefined }]),
  );
  assert.equal(
    validateDistribution(p, [
      {
        ...a,
        amount: "40.80",
        projectId: undefined,
        category: "General Overhead",
      },
    ]).length,
    1,
  );
});
test("source identifiers distinguish exports while receipt evidence flags cross-source duplicates", () => {
  const a = parsePurchases(sample())[0],
    b = parsePurchases(sample({ source: "HOME_DEPOT_CSV" }))[0];
  assert.notEqual(a.sourceKey, b.sourceKey);
  assert.equal(a.evidenceKey, b.evidenceKey);
  const c = parsePurchases(sample({ receipt_id: "different-receipt" }))[0];
  assert.notEqual(a.evidenceKey, c.evidenceKey);
});
