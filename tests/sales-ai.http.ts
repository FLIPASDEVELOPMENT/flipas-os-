import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { db } from "../src/server/db";
import { encryptSecret } from "../src/sales-ai/domain/security";
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
    // Synthetic records in the disposable test DB; no API invocation.
    for (const [code, stage] of [
      ["INVALID_AI_OUTPUT_FORMAT", "FORMAT"],
      ["INVALID_AI_OUTPUT_SCHEMA", "SCHEMA"],
      ["AI_OUTPUT_INCOMPLETE", "COMPLETION"],
      ["AI_OUTPUT_REFUSED", "SAFETY"],
    ]) {
      const usage = await db.salesAIUsage.create({
        data: {
          provider: "OPENAI",
          model: "simulation-only",
          conversationId: thread.id,
          success: false,
          status: "REJECTED",
          errorCode: code,
        },
      });
      await db.activity.create({
        data: {
          type: "AI_REQUEST_RECORDED",
          message: "Simulated diagnostic",
          metadata: { usageId: usage.id, diagnostics: { stage } },
        },
      });
    }
    const sendingMailbox = await db.mailConnection.create({
      data: {
        provider: "ZOHO",
        ownerId: owner.u.id,
        region: "US",
        accountId: "99001",
        address: "owner-self@example.invalid",
        connected: true,
        consented: true,
      },
    });
    await db.mailWriteConsent.create({
      data: {
        connectionId: sendingMailbox.id,
        ownerId: owner.u.id,
        region: "US",
        accountId: sendingMailbox.accountId,
        address: sendingMailbox.address,
        consentedAt: new Date(),
        authorizedAt: new Date(),
        scopes: ["ZohoMail.accounts.READ", "ZohoMail.messages.CREATE"],
        sendEnabled: false,
        testOnly: true,
        tokenCipher: encryptSecret("synthetic-write-grant"),
        oauthSecretCipher: encryptSecret("synthetic-write-secret"),
      },
    });
    await db.activity.create({
      data: {
        type: "MAIL_WRITE_CONNECTION_TESTED",
        message: "Access tested",
        actorId: owner.u.id,
        metadata: {
          connectionId: sendingMailbox.id,
          success: true,
          errorCode: null,
          delivery: false,
        },
        createdAt: new Date("2026-10-08T12:41:00Z"),
      },
    });
    const diagnosticPage = await fetch(base + "/owner/ai", {
      headers: owner.headers,
    });
    assert.equal(diagnosticPage.status, 200);
    const diagnosticHtml = await diagnosticPage.text();
    assert.match(diagnosticHtml, /Separate Zoho sending authorization/);
    assert.match(
      diagnosticHtml,
      /Deployment gate:(?:<!-- -->)? <strong>disabled<\/strong>/,
    );
    assert.match(diagnosticHtml, /One self-addressed test only/);
    assert.ok(
      !diagnosticHtml.includes("synthetic-write-secret") &&
        !diagnosticHtml.includes("synthetic-write-grant"),
    );
    assert.match(diagnosticHtml, /Access test[\s\S]{0,40}successful/);
    assert.match(diagnosticHtml, /2026-10-08T12:41:00.000Z/);
    assert.match(diagnosticHtml, /Zoho confirmed access to this exact mailbox/);
    assert.match(
      diagnosticHtml,
      /No email was sent. Emergency Pause is unchanged/,
    );
    const testForm = [
      ...diagnosticHtml.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g),
    ]
      .map((m) => m[0])
      .find((f) => f.includes("Test access — no email sent"));
    assert.ok(testForm);
    const testAction = testForm.match(/name="(\$ACTION_ID_[^"]+)"/);
    assert.ok(testAction);
    const testData = new FormData();
    testData.set(testAction[1], "");
    testData.set("operation", "test");
    testData.set("id", sendingMailbox.id);
    const deniedTest = await fetch(base + "/owner/ai", {
      method: "POST",
      headers: { ...sales.headers, Origin: base },
      body: testData,
      redirect: "manual",
    });
    assert.equal(deniedTest.status, 404);
    await db.activity.create({
      data: {
        type: "MAIL_WRITE_CONNECTION_TESTED",
        message: "Access tested",
        actorId: owner.u.id,
        metadata: {
          connectionId: sendingMailbox.id,
          success: false,
          errorCode: "ACCOUNT_MISMATCH",
          delivery: false,
        },
      },
    });
    const failedHtml = await (
      await fetch(base + "/owner/ai", { headers: owner.headers })
    ).text();
    assert.match(failedHtml, /Access test[\s\S]{0,40}failed/);
    assert.match(failedHtml, /Zoho returned a different mailbox/);
    assert.match(failedHtml, /role="alert"/);
    // Missing grant fails locally before any provider call; exercise the actual action.
    await db.mailWriteConsent.update({ where: { connectionId: sendingMailbox.id }, data: { tokenCipher: null } });
    const failedTest = await fetch(base + "/owner/ai", { method: "POST", headers: { ...owner.headers, Origin: base }, body: testData, redirect: "manual" });
    assert.equal(failedTest.status, 303);
    assert.equal(failedTest.headers.get("location"), "/owner/ai?error=WRITE_AUTH_REQUIRED");
    const actualFailureHtml = await (await fetch(base + "/owner/ai", { headers: owner.headers })).text();
    assert.match(actualFailureHtml, /Sending authorization is missing or revoked/);
    assert.equal((await db.salesAISettings.findUniqueOrThrow({ where: { id: "company" } })).outboundPaused, true);

    const deliveryForm = [
      ...diagnosticHtml.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g),
    ]
      .map((m) => m[0])
      .find((f) => f.includes("deliveryConsent"));
    assert.ok(deliveryForm);
    assert.match(deliveryForm, /<button[^>]*disabled/);
    assert.match(deliveryForm, /Mailbox delivery authorization is blocked because the deployment gate is disabled/);
    assert.match(deliveryForm, /Checking consent does not override this server safety control/);
    assert.match(deliveryForm, /ZOHO_SEND_ENABLED must be exactly true/);
    assert.match(deliveryForm, /aria-describedby="delivery-gate-/);
    assert.match(deliveryForm, /It cannot send to third parties/);
    const deliveryAction = deliveryForm.match(/name="(\$ACTION_ID_[^"]+)"/);
    assert.ok(deliveryAction);
    const activation = new FormData();
    activation.set(deliveryAction[1], "");
    activation.set("id", sendingMailbox.id);
    activation.set("operation", "enable");
    activation.set("mode", "SELF_TEST");
    activation.set("deliveryConsent", "on");
    const deniedActivation = await fetch(base + "/owner/ai", {
      method: "POST",
      headers: { ...sales.headers, Origin: base },
      body: activation,
      redirect: "manual",
    });
    assert.equal(
      deniedActivation.status,
      404,
      "SALES cannot forge OWNER sending activation",
    );
    const stillPaused = await fetch(base + "/owner/ai", {
      method: "POST",
      headers: { ...owner.headers, Origin: base },
      body: activation,
      redirect: "manual",
    });
    assert.equal(stillPaused.status, 303);
    assert.equal(
      stillPaused.headers.get("location"),
      "/owner/ai?error=LIVE_DISABLED",
    );
    assert.equal(
      (
        await db.mailWriteConsent.findUniqueOrThrow({
          where: { connectionId: sendingMailbox.id },
        })
      ).sendEnabled,
      false,
    );
    for (const stage of ["FORMAT", "SCHEMA", "COMPLETION", "SAFETY"])
      assert.match(
        diagnosticHtml,
        new RegExp("Validation stage: (?:<!-- -->)?" + stage),
      );
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
      const setup = await fetch(base + "/owner/ai/zoho", {
        headers,
        redirect: "manual",
      });
      assert.equal(
        setup.status,
        u.role === "OWNER" ? 200 : 404,
        u.role + " Zoho setup",
      );
      const callback = await fetch(
        base + "/api/owner/zoho/callback?state=invalid",
        { headers, redirect: "manual" },
      );
      assert.equal(
        callback.status,
        u.role === "OWNER" ? 303 : 403,
        u.role + " Zoho callback",
      );
      if (u.role === "OWNER")
        assert.equal(
          callback.headers.get("location"),
          "/owner/ai?error=ACCESS_DENIED",
        );
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
    for (const path of [
      "/ai",
      "/ai/inbox",
      "/ai/follow-ups",
      "/owner/ai",
      "/owner/ai/zoho",
    ]) {
      const r = await fetch(base + path, { redirect: "manual" });
      assert.equal(r.status, 307);
      assert.equal(r.headers.get("location"), "/login");
    }
    assert.equal(
      (await fetch(base + "/api/owner/zoho/callback", { redirect: "manual" }))
        .status,
      403,
    );
    await db.salesAISettings.update({
      where: { id: "company" },
      data: {
        oauthClientId: "test-oauth-client",
        oauthRegion: "US",
        oauthSecretCipher: encryptSecret("synthetic-test-secret"),
      },
    });
    const ownerPage = await fetch(base + "/owner/ai", {
      headers: owner.headers,
    });
    const ownerHtml = await ownerPage.text();
    assert.ok(!ownerHtml.includes("synthetic-test-secret"));
    const connectForm = [
      ...ownerHtml.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g),
    ]
      .map((m) => m[0])
      .find((f) => f.includes("Authorize read-only Zoho access"));
    assert.ok(connectForm);
    const connectAction = connectForm.match(/name="(\$ACTION_ID_[^"]+)"/);
    assert.ok(connectAction);
    const connectData = new FormData();
    connectData.set(connectAction[1], "");
    const stateCount = await db.mailOAuthState.count();
    const blocked = await fetch(base + "/owner/ai", {
      method: "POST",
      headers: {
        ...owner.headers,
        Origin: "https://untrusted.example.invalid",
      },
      body: connectData,
      redirect: "manual",
    });
    assert.ok(blocked.status >= 400);
    assert.equal(await db.mailOAuthState.count(), stateCount);
    const denied = await fetch(base + "/owner/ai", {
      method: "POST",
      headers: { ...sales.headers, Origin: base },
      body: connectData,
      redirect: "manual",
    });
    assert.ok(denied.status >= 400);
    assert.equal(await db.mailOAuthState.count(), stateCount);
    const start = await fetch(base + "/owner/ai", {
      method: "POST",
      headers: { ...owner.headers, Origin: base },
      body: connectData,
      redirect: "manual",
    });
    assert.equal(start.status, 303);
    const authorization = new URL(start.headers.get("location")!);
    assert.equal(authorization.origin, "https://accounts.zoho.com");
    assert.ok(!authorization.searchParams.get("scope")!.includes("CREATE"));
    assert.equal(
      authorization.searchParams.get("redirect_uri"),
      base + "/api/owner/zoho/callback",
    );
    const bindingCookie = start.headers.get("set-cookie")!;
    assert.ok(/httponly/i.test(bindingCookie));
    assert.ok(/samesite=lax/i.test(bindingCookie));
    const binding = bindingCookie.match(/flipas_zoho_binding=([^;]+)/)![1];
    // Region mismatch consumes state but must reject before exchanging the synthetic code.
    const query = new URLSearchParams({
      state: authorization.searchParams.get("state")!,
      code: "synthetic-code",
      location: "eu",
      "accounts-server": "https://attacker.example.invalid",
    });
    const failed = await fetch(base + "/api/owner/zoho/callback?" + query, {
      headers: {
        Cookie: owner.headers.Cookie + "; flipas_zoho_binding=" + binding,
      },
      redirect: "manual",
    });
    assert.equal(failed.status, 303);
    assert.equal(
      failed.headers.get("location"),
      "/owner/ai?error=AUTH_REQUIRED",
    );
    assert.equal(failed.headers.get("cache-control"), "no-store");
    const consumed = await db.mailOAuthState.findFirstOrThrow({
      where: { userId: owner.u.id },
      orderBy: { expiresAt: "desc" },
    });
    assert.ok(consumed.usedAt);
    assert.equal(await db.mailOAuthGrant.count(), 0);
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
