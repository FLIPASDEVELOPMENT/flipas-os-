import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../src/server/db";
import { tokenHash } from "../src/server/auth";
import { sample } from "./purchases.fixture";
import { importCSV, reviewPurchase } from "../src/purchases/service";
if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
  throw new Error("Disposable *_test database required");
let checkpoint = "setup";
async function main() {
  const base = process.env.SMOKE_BASE_URL!,
    project = await db.project.findFirstOrThrow();
  const owner = await db.user.create({
    data: {
      role: "OWNER",
      name: "Purchase HTTP",
      email: randomUUID() + "@example.invalid",
      passwordHash: "not-login",
    },
  });
  const result = await importCSV(
    owner,
    "test.csv",
    sample({ external_id: randomUUID(), receipt_id: randomUUID() }),
  );
  const p = await db.importedPurchase.findFirstOrThrow({
    where: { documentId: result.documentId },
  });
  await reviewPurchase(
    owner,
    p.id,
    0,
    [
      {
        lineId: "1",
        amount: "40.80",
        category: "Tile",
        costType: "MATERIAL",
        projectId: project.id,
      },
    ],
    "Verified HTTP fixture",
  );
  let action = "";
  for (const role of [
    "OWNER",
    "ADMIN",
    "SALES",
    "PROJECT_MANAGER",
    "CREW",
    "CUSTOMER",
  ] as const) {
    const user =
        role === "OWNER"
          ? owner
          : await db.user.create({
              data: {
                role,
                name: "Purchase HTTP",
                email: randomUUID() + "@example.invalid",
                passwordHash: "not-login",
              },
            }),
      token = randomBytes(32).toString("hex");
    await db.session.create({
      data: {
        userId: user.id,
        tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    const headers = { Cookie: `flipas_session=${token}` };
    for (const path of [
      "/owner/purchases",
      "/owner/purchases/reports",
      "/owner/purchases/batch",
      "/owner/purchases/" + p.id,
    ]) {
      checkpoint = role + " " + path;
      for (const h of [headers, { ...headers, RSC: "1" }]) {
        const r = await fetch(base + path, { headers: h }),
          body = await r.text();
        if (role === "OWNER") {
          assert.equal(r.status, 200);
          if (path === "/owner/purchases/" + p.id) {
            assert.ok(body.includes("Exact saved review"));
            action = body.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1] ?? action;
          }
        } else {
          if ("RSC" in h && r.status === 200)
            assert.ok(body.includes("NEXT_HTTP_ERROR_FALLBACK;404"));
          else assert.equal(r.status, 404);
          assert.equal(body.includes("40.80"), false);
          assert.equal(
            body.includes("Purchase private financial sentinel"),
            false,
          );
        }
      }
    }
    const doc = await fetch(
      base + "/api/owner/purchases/documents/" + result.documentId,
      { headers },
    );
    assert.equal(doc.status, role === "OWNER" ? 200 : 403);
    if (role === "OWNER") {
      assert.ok(doc.headers.get("content-disposition")?.includes(".csv.txt"));
      assert.equal(doc.headers.get("x-content-type-options"), "nosniff");
      assert.ok(
        (await doc.text()).includes("Purchase private financial sentinel"),
      );
    }
    if (role !== "OWNER") {
      checkpoint = role + " forged approval";
      const form = new FormData();
      form.set(action, "");
      form.set("operation", "approve");
      form.set("purchaseId", p.id);
      form.set("version", "1");
      form.set("confirmation", "on");
      const r = await fetch(base + "/owner/purchases/" + p.id, {
        method: "POST",
        headers: { ...headers, Origin: base },
        body: form,
        redirect: "manual",
      });
      assert.ok([303, 404].includes(r.status));
      assert.equal(
        (await db.importedPurchase.findUniqueOrThrow({ where: { id: p.id } }))
          .status,
        "NEEDS_REVIEW",
      );
    }
  }
  assert.equal(
    (await fetch(base + "/api/owner/purchases/documents/" + result.documentId))
      .status,
    401,
  );
  console.log(
    "Purchases HTTP PASS: OWNER pages/document; five role HTML/RSC/API denials; forged approval denied; original evidence downloaded as untrusted text",
  );
}
main()
  .catch(() => {
    console.error(
      "Purchases HTTP failed at " + checkpoint + "; no request data logged",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
