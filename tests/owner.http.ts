import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { db } from "../src/server/db";
import { tokenHash } from "../src/server/auth";
if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
  throw new Error("Disposable *_test database required");
async function main() {
  const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3003";
  const ids: string[] = [];
  try {
    for (const role of ["OWNER", "SALES", "ADMIN", "CREW"] as const) {
      const user = await db.user.create({
        data: {
          name: "HTTP test",
          email: `${randomBytes(12).toString("hex")}@example.invalid`,
          role,
          passwordHash: "not-a-login-hash",
        },
      });
      ids.push(user.id);
      const token = randomBytes(32).toString("hex");
      await db.session.create({
        data: {
          userId: user.id,
          tokenHash: tokenHash(token),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      const headers = { Cookie: `flipas_session=${token}` };
      for (const path of [
        "/owner",
        "/owner/policies",
        "/owner/approvals",
        "/owner/team",
        "/owner/profitability",
      ]) {
        const response = await fetch(base + path, {
          headers,
          redirect: "manual",
        });
        assert.equal(
          response.status,
          role === "OWNER" ? 200 : 404,
          `${role} ${path}`,
        );
        if (role !== "OWNER")
          assert.ok(
            !(await response.text()).includes("monthlyProjectedRevenue"),
          );
      }
      const response = await fetch(base + "/api/owner/summary", { headers });
      assert.equal(response.status, role === "OWNER" ? 200 : 403);
      if (role === "OWNER") {
        const data = await response.json();
        assert.ok(data.policy.version);
      }
    }
    assert.equal((await fetch(base + "/api/owner/summary")).status, 401);
    const anonymous = await fetch(base + "/owner", { redirect: "manual" });
    assert.equal(anonymous.status, 307);
    assert.equal(anonymous.headers.get("location"), "/login");
    console.log(
      "Owner HTTP passed: 5 owner routes, API, all four role checks and anonymous denial",
    );
  } finally {
    await db.user.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
