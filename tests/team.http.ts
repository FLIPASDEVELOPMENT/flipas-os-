import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { db } from "../src/server/db";
import { tokenHash } from "../src/server/auth";
if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
  throw new Error("Disposable *_test database required");
async function session(
  role: "OWNER" | "ADMIN" | "SALES" | "PROJECT_MANAGER" | "CREW" | "CUSTOMER",
  pending = false,
) {
  const user = await db.user.create({
    data: {
      role,
      name: "HTTP team",
      email: randomBytes(12).toString("hex") + "@example.invalid",
      passwordHash: "not-login",
      passwordChangeRequired: pending,
    },
  });
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash: tokenHash(token),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  return { user, headers: { Cookie: `flipas_session=${token}` } };
}
let checkpoint = "start";
async function main() {
  const base = process.env.SMOKE_BASE_URL!;
  let action = "";
  const admin = await session("OWNER");
  checkpoint = "OWNER page";
  const page = await fetch(base + "/owner/team", { headers: admin.headers });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes("Create employee account"));
  assert.ok(html.includes("Revoke all sessions"));
  assert.equal(html.includes("passwordHash"), false);
  const createForm = [
    ...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g),
  ].find((x) => x[1].includes('name="operation" value="create"'))?.[1];
  assert.ok(createForm);
  action = createForm.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1] ?? "";
  assert.ok(action);
  const email = randomBytes(12).toString("hex") + "@example.invalid";
  const form = () => {
    const d = new FormData();
    d.set(action, "");
    d.set("operation", "create");
    d.set("name", "HTTP provisioned");
    d.set("email", email);
    d.set("role", "CREW");
    d.set("password", "http-test-private-initial-password");
    d.set("confirmation", "http-test-private-initial-password");
    return d;
  };
  for (const role of [
    "ADMIN",
    "SALES",
    "PROJECT_MANAGER",
    "CREW",
    "CUSTOMER",
  ] as const) {
    checkpoint = "denial: " + role;
    const account = await session(role);
    for (const headers of [account.headers, { ...account.headers, RSC: "1" }]) {
      checkpoint =
        "page denial: " + role + ("RSC" in headers ? " RSC" : " HTML");
      const denied = await fetch(base + "/owner/team", { headers });
      const body = await denied.text();
      // Flight can carry notFound as an error digest after streaming starts.
      if ("RSC" in headers && denied.status === 200)
        assert.ok(body.includes("NEXT_HTTP_ERROR_FALLBACK;404"));
      else assert.equal(denied.status, 404);
      assert.equal(body.includes("Create employee account"), false);
      assert.equal(body.includes("HTTP provisioned"), false);
    }
    checkpoint = "action denial: " + role;
    const forged = await fetch(base + "/owner/team", {
      method: "POST",
      headers: { ...account.headers, Origin: base },
      body: form(),
      redirect: "manual",
    });
    assert.ok([303, 404].includes(forged.status));
    assert.equal(await db.user.count({ where: { email } }), 0);
    checkpoint = "API denial: " + role;
    assert.equal(
      (await fetch(base + "/api/owner/summary", { headers: account.headers }))
        .status,
      403,
    );
  }
  checkpoint = "Origin denial";
  const wrongOrigin = await fetch(base + "/owner/team", {
    method: "POST",
    headers: { ...admin.headers, Origin: "https://attacker.invalid" },
    body: form(),
    redirect: "manual",
  });
  assert.ok([403, 500].includes(wrongOrigin.status));
  assert.equal(await db.user.count({ where: { email } }), 0);
  checkpoint = "provisioning";
  const created = await fetch(base + "/owner/team", {
    method: "POST",
    headers: { ...admin.headers, Origin: base },
    body: form(),
    redirect: "manual",
  });
  assert.equal(created.status, 303);
  const employee = await db.user.findUniqueOrThrow({ where: { email } });
  assert.equal(employee.passwordChangeRequired, true);
  assert.notEqual(employee.passwordHash, "http-test-private-initial-password");
  checkpoint = "initial login";
  const loginPage = await fetch(base + "/login");
  const loginAction = (await loginPage.text()).match(
    /name="(\$ACTION_ID_[^"]+)"/,
  )?.[1];
  assert.ok(loginAction);
  const loginForm = new FormData();
  loginForm.set(loginAction, "");
  loginForm.set("email", email);
  loginForm.set("password", "http-test-private-initial-password");
  const login = await fetch(base + "/login", {
    method: "POST",
    headers: { Origin: base },
    body: loginForm,
    redirect: "manual",
  });
  assert.equal(login.status, 303);
  assert.equal(login.headers.get("location"), "/account/password");
  const employeeHeaders = {
    Cookie: login.headers.get("set-cookie")?.split(";")[0] ?? "",
  };
  assert.ok(employeeHeaders.Cookie.startsWith("flipas_session="));
  checkpoint = "password setup";
  const setup = await fetch(base + "/account/password", {
    headers: employeeHeaders,
  });
  const setupHtml = await setup.text();
  assert.equal(setupHtml.includes("http-test-private-initial-password"), false);
  assert.equal(setupHtml.includes(employee.passwordHash), false);
  const setupAction = setupHtml.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];
  assert.ok(setupAction);
  const setupForm = new FormData();
  setupForm.set(setupAction, "");
  setupForm.set("currentPassword", "http-test-private-initial-password");
  setupForm.set("password", "http-test-private-personal-password");
  setupForm.set("confirmation", "http-test-private-personal-password");
  const changed = await fetch(base + "/account/password", {
    method: "POST",
    headers: { ...employeeHeaders, Origin: base },
    body: setupForm,
    redirect: "manual",
  });
  assert.equal(changed.status, 303);
  assert.equal(changed.headers.get("location"), "/login?changed=1");
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: employee.id } }))
      .passwordChangeRequired,
    false,
  );
  assert.equal(await db.session.count({ where: { userId: employee.id } }), 0);
  assert.equal(
    (
      await fetch(base + "/projects", {
        headers: employeeHeaders,
        redirect: "manual",
      })
    ).headers.get("location"),
    "/login",
  );
  checkpoint = "pending session restrictions";
  const pending = await session("CREW", true);
  assert.equal(
    (
      await fetch(base + "/projects", {
        headers: pending.headers,
        redirect: "manual",
      })
    ).headers.get("location"),
    "/account/password",
  );
  assert.equal(
    (await fetch(base + "/api/owner/summary", { headers: pending.headers }))
      .status,
    401,
  );
  const passwordPage = await fetch(base + "/account/password", {
    headers: pending.headers,
  });
  assert.equal(passwordPage.status, 200);
  assert.equal((await passwordPage.text()).includes("not-login"), false);
  checkpoint = "revoked session";
  await db.session.deleteMany({ where: { userId: admin.user.id } });
  assert.equal(
    (
      await fetch(base + "/owner/team", {
        headers: admin.headers,
        redirect: "manual",
      })
    ).headers.get("location"),
    "/login",
  );
  console.log(
    "Team HTTP PASS: all six roles, forged actions, Origin, HTML/RSC/API denial, private provisioning, forced password setup and session revocation",
  );
}
main()
  .catch(() => {
    console.error(
      "Team HTTP failed at " + checkpoint + "; no headers or secrets logged",
    );
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
