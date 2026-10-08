import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { db } from "../src/server/db";
import { tokenHash } from "../src/server/auth";
import {
  initializeMock,
  syncMailbox,
  analyzeConversation,
  assignConversation,
} from "../src/sales-ai/server/service";
if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
  throw new Error("Disposable *_test database required");
const base = process.env.SMOKE_BASE_URL ?? "http://localhost:3005";
async function main() {
  try {
    const users = [];
    for (const role of [
      "OWNER",
      "ADMIN",
      "SALES",
      "SALES",
      "CREW",
      "PROJECT_MANAGER",
      "CUSTOMER",
    ] as const) {
      const u = await db.user.create({
        data: {
          name: "HTTP " + role,
          role,
          email: randomBytes(16).toString("hex") + "@example.invalid",
          passwordHash: "not-a-login-hash",
        },
      });
      const token = randomBytes(32).toString("hex");
      await db.session.create({
        data: {
          userId: u.id,
          tokenHash: tokenHash(token),
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      users.push({ u, headers: { Cookie: "flipas_session=" + token } });
    }
    const owner = users[0],
      sales = users[2];
    await initializeMock(owner.u);
    const connection = await db.mailConnection.findUniqueOrThrow({
      where: {
        provider_accountId: { provider: "MOCK", accountId: "development-only" },
      },
    });
    await syncMailbox(connection.id);
    const thread = await db.mailConversation.findFirstOrThrow({
      where: { threadId: "development-kitchen" },
    });
    await analyzeConversation(thread.id);
    await assignConversation(owner.u, thread.id, sales.u.id);
    for (const [i, { u, headers }] of users.entries()) {
      const crm = ["OWNER", "ADMIN", "SALES"].includes(u.role);
      for (const path of ["/ai", "/ai/inbox", "/ai/follow-ups"]) {
        const r = await fetch(base + path, { headers, redirect: "manual" });
        assert.equal(r.status, crm ? 200 : 404, u.role + " " + path);
        const html = await r.text();
        if (!crm) assert.ok(!html.includes("customer@example.invalid"));
      }
      const r = await fetch(base + "/owner/ai", {
        headers,
        redirect: "manual",
      });
      assert.equal(
        r.status,
        u.role === "OWNER" ? 200 : 404,
        u.role + " owner administration",
      );
      if (u.role !== "OWNER")
        assert.ok(!(await r.text()).includes("Sending activity"));
      const c = await fetch(base + "/ai/inbox/" + thread.id, {
        headers,
        redirect: "manual",
      });
      assert.equal(
        c.status,
        i === 0 || i === 1 || i === 2 ? 200 : 404,
        u.role + " scoped thread",
      );
    }
    for (const path of ["/ai", "/ai/inbox", "/ai/follow-ups", "/owner/ai"]) {
      const r = await fetch(base + path, { redirect: "manual" });
      assert.equal(r.status, 307);
      assert.equal(r.headers.get("location"), "/login");
    }
    const page = await fetch(base + "/ai/inbox/" + thread.id, {
      headers: sales.headers,
    });
    const html = await page.text();
    const formHtml = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
      .map((match) => match[0])
      .find((block) => block.includes("Draft qualifying reply"));
    assert.ok(formHtml, "Draft generation action rendered");
    const action = formHtml.match(/name="(\$ACTION_ID_[^"]+)"/);
    assert.ok(action);
    const form = new FormData();
    form.set(action[1], "");
    form.set("id", thread.id);
    form.set("operation", "generate");
    form.set("language", "EN");
    const baseline = await db.salesEmailDraft.count({
      where: { conversationId: thread.id },
    });
    const csrf = await fetch(base + "/ai/inbox/" + thread.id, {
      method: "POST",
      headers: {
        ...sales.headers,
        Origin: "https://untrusted.example.invalid",
      },
      body: form,
      redirect: "manual",
    });
    assert.ok(csrf.status >= 400, "Cross origin mutation denied");
    assert.equal(
      await db.salesEmailDraft.count({ where: { conversationId: thread.id } }),
      baseline,
    );
    const accepted = await fetch(base + "/ai/inbox/" + thread.id, {
      method: "POST",
      headers: { ...sales.headers, Origin: base },
      body: form,
      redirect: "manual",
    });
    assert.equal(accepted.status, 303);
    assert.equal(
      await db.salesEmailDraft.count({ where: { conversationId: thread.id } }),
      baseline + 1,
    );
    const hidden = await fetch(base + "/ai/inbox/" + thread.id, {
      headers: users[3].headers,
    });
    assert.equal(hidden.status, 404);
    console.log(
      "AI HTTP passed: seven role identities, owner-only administration, assigned inbox, anonymous denial and server-action CSRF.",
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
