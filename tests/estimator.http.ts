import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import { db } from "../src/server/db";
import { hashPassword } from "../src/server/password";
if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
  throw new Error("Estimator HTTP tests require disposable *_test database");
async function main() {
  const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
  const suffix = randomBytes(8).toString("hex");
  const password = randomBytes(24).toString("hex");
  const user = await db.user.create({
    data: {
      email: `smoke-${suffix}@example.invalid`,
      name: "Smoke test owner",
      role: "OWNER",
      passwordHash: await hashPassword(password),
    },
  });
  try {
    const denied = await fetch(base + "/", { redirect: "manual" });
    assert.equal(denied.status, 307);
    assert.equal(denied.headers.get("location"), "/login");
    const login = await fetch(base + "/login");
    assert.equal(login.status, 200);
    const html = await login.text();
    assert.ok(html.includes("FLIPAS OS"));
    const action = html.match(/name="(\$ACTION_ID_[^"]+)"/);
    assert.ok(action, "Login action must be rendered");
    const form = new FormData();
    form.set(action[1], "");
    form.set("email", user.email);
    form.set("password", password);
    const signed = await fetch(base + "/login", {
      method: "POST",
      body: form,
      headers: { Origin: base },
      redirect: "manual",
    });
    assert.equal(signed.status, 303);
    const cookie = signed.headers.get("set-cookie");
    assert.ok(cookie?.includes("HttpOnly"));
    assert.ok(cookie?.includes("SameSite=lax"));
    assert.ok(cookie?.includes("Secure"));
    assert.ok(cookie);
    const sessionCookie = cookie.split(";")[0];
    for (const route of [
      "/",
      "/customers",
      "/leads",
      "/pipeline",
      "/settings",
      "/ai",
      "/estimates",
      "/estimates/new",
      "/estimates/catalog",
      "/estimates/templates",
      "/estimates/settings",
      "/projects",
    ]) {
      const response = await fetch(base + route, {
        headers: { Cookie: sessionCookie },
      });
      assert.equal(response.status, 200, route);
      const body = await response.text();
      assert.ok(body.includes("FLIPAS OS"), route);
      assert.ok(!body.includes("Unable to complete this request"), route);
    }
    const estimate = await db.estimate.findFirstOrThrow({
      where: { status: "ACCEPTED" },
    });
    for (const route of [
      `/estimates/${estimate.id}`,
      `/proposals/${estimate.id}`,
    ]) {
      const response = await fetch(base + route, {
        headers: { Cookie: sessionCookie },
      });
      assert.equal(response.status, 200, route);
      const text = await response.text();
      if (route.startsWith("/proposals")) {
        assert.ok(!text.includes("INTERNAL ONLY"));
        assert.ok(!text.includes("Owner-reviewed development exception"));
        assert.ok(!text.includes("minimumMargin"));
      }
    }
    const pdfRoute = `/api/estimates/${estimate.id}/pdf`;
    assert.equal((await fetch(base + pdfRoute)).status, 401);
    const pdf = await fetch(base + pdfRoute, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(pdf.status, 200);
    assert.ok(pdf.headers.get("content-type")?.includes("application/pdf"));
    assert.equal(
      Buffer.from(await pdf.arrayBuffer())
        .subarray(0, 4)
        .toString(),
      "%PDF",
    );
    await db.user.update({ where: { id: user.id }, data: { active: false } });
    const revoked = await fetch(base + "/", {
      headers: { Cookie: sessionCookie },
      redirect: "manual",
    });
    assert.equal(revoked.status, 307);
    console.log(
      "HTTP smoke passed: protected redirect, real login, secure cookie, twelve authenticated pages, estimator detail, private proposal and PDF, immediate revocation",
    );
  } finally {
    await db.activity.deleteMany({ where: { actorId: user.id } });
    await db.user.delete({ where: { id: user.id } });
    await db.loginAttempt.deleteMany({
      where: { key: createHash("sha256").update(user.email).digest("hex") },
    });
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
