import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalState,
  validTransition,
  assertAcyclic,
  money,
  signedMoney,
  day,
  templateDefinition,
  templates,
} from "../src/project-operations/domain/rules";
import { validateEvidenceFile } from "../src/project-operations/server/evidence";
test("legacy states preserve lifecycle and terminal states cannot reopen", () => {
  assert.equal(canonicalState("PRE_CONSTRUCTION"), "PLANNING");
  assert.equal(canonicalState("PUNCH_LIST"), "QUALITY_REVIEW");
  validTransition("PRE_CONSTRUCTION", "SCHEDULED");
  assert.throws(() => validTransition("COMPLETED", "IN_PROGRESS"));
  assert.throws(() => validTransition("PLANNING", "COMPLETED"));
});
test("dependencies reject cycles", () => {
  assertAcyclic("a", "b", []);
  assert.throws(() =>
    assertAcyclic("a", "b", [
      { taskId: "b", prerequisiteId: "c" },
      { taskId: "c", prerequisiteId: "a" },
    ]),
  );
  assert.throws(() => assertAcyclic("a", "a", []));
});
test("financial and calendar input rejects overflow, negatives and impossible days", () => {
  assert.equal(money.safeParse("-1").success, false);
  assert.equal(money.safeParse("1.001").success, false);
  assert.equal(signedMoney.safeParse("-100.25").success, true);
  assert.equal(day.safeParse("2026-02-30").success, false);
  assert.equal(day.safeParse("2026-10-09").success, true);
});
test("three editable execution templates have validated stages and tasks", () => {
  assert.equal(templates.length, 3);
  for (const t of templates)
    assert.ok(templateDefinition.parse({ stages: t.stages }));
  assert.equal(templateDefinition.safeParse({ stages: [] }).success, false);
});
test("evidence rejects active content, empty files, oversized files and forged dimensions", () => {
  for (const b of [
    Buffer.from("<svg/>"),
    Buffer.from("%PDF-1.7"),
    Buffer.alloc(0),
    Buffer.alloc(5 * 1024 * 1024 + 1),
  ])
    assert.throws(() => validateEvidenceFile(b, "photo"));
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.write("IHDR", 12);
  png.writeUInt32BE(100000, 16);
  png.writeUInt32BE(100000, 20);
  assert.throws(() => validateEvidenceFile(png, "x.png"));
});
import { handoffDiagnostic } from "../src/estimator/domain/handoff";
test("handoff diagnostics check exact IDs, not labels or price equality", () => {
  const e = {
    status: "ACCEPTED",
    customerId: "customer-A",
    opportunityId: "opp-A",
    opportunity: { id: "opp-A", stage: "WON", customerId: "customer-A" },
  };
  assert.equal(handoffDiagnostic(e).code, "READY");
  assert.equal(
    handoffDiagnostic({ ...e, status: "SENT" }).code,
    "ESTIMATE_NOT_ACCEPTED",
  );
  assert.equal(
    handoffDiagnostic({ ...e, opportunityId: null, opportunity: null }).code,
    "NO_OPPORTUNITY_LINK",
  );
  assert.equal(
    handoffDiagnostic({ ...e, opportunity: { ...e.opportunity, id: "opp-B" } })
      .code,
    "OPPORTUNITY_UNAVAILABLE",
  );
  assert.equal(
    handoffDiagnostic({
      ...e,
      opportunity: { ...e.opportunity, customerId: "same-name-different-ID" },
    }).code,
    "CUSTOMER_ID_MISMATCH",
  );
  assert.equal(
    handoffDiagnostic({ ...e, opportunity: { ...e.opportunity, stage: "NEW" } })
      .code,
    "LINKED_OPPORTUNITY_NOT_WON",
  );
});
test("recommended procedures include practical checklist criteria and bounded size", () => {
  for (const t of templates) {
    const d = templateDefinition.parse({ stages: t.stages });
    assert.ok(d.stages.some((s) => s.title === "Handover"));
    assert.ok(
      d.stages.every((s) =>
        s.tasks.every((task) => (s.checklists?.[task]?.length ?? 0) > 0),
      ),
    );
  }
  assert.equal(
    templateDefinition.safeParse({
      stages: [
        { title: "Test", tasks: ["A"], checklists: { B: ["Wrong task"] } },
      ],
    }).success,
    false,
  );
});
