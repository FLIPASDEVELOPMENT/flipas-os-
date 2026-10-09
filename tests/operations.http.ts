import sharp from "sharp";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { db } from "../src/server/db";
import { tokenHash } from "../src/server/auth";
if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test"))
  throw new Error("Disposable *_test database required");
async function main() {
  const base = process.env.SMOKE_BASE_URL!;
  try {
    const project = await db.project.findFirstOrThrow({
      orderBy: { createdAt: "desc" },
    });
    for (const role of ["OWNER", "ADMIN", "PROJECT_MANAGER", "CREW"] as const) {
      const u = await db.user.create({
        data: {
          role,
          name: "HTTP operations",
          email: randomBytes(12).toString("hex") + "@example.invalid",
          passwordHash: "not-login",
        },
      });
      if (role !== "OWNER")
        await db.projectMember.create({
          data: { projectId: project.id, userId: u.id },
        });
      const token = randomBytes(32).toString("hex");
      await db.session.create({
        data: {
          userId: u.id,
          tokenHash: tokenHash(token),
          expiresAt: new Date(Date.now() + 60000),
        },
      });
      const headers = { Cookie: `flipas_session=${token}` };
      if (role === "OWNER") {
        const task = await db.projectTask.create({
          data: { projectId: project.id, title: "HTTP photo target" },
        });
        const bytes = await sharp({
          create: { width: 4, height: 4, channels: 3, background: "white" },
        })
          .png()
          .toBuffer();
        const form = new FormData();
        form.set("taskId", task.id);
        form.set(
          "file",
          new Blob([new Uint8Array(bytes)], { type: "image/png" }),
          "photo.png",
        );
        const uploaded = await fetch(
          base + `/api/projects/${project.id}/evidence`,
          {
            method: "POST",
            headers: { ...headers, Origin: base },
            body: form,
            redirect: "manual",
          },
        );
        assert.equal(uploaded.status, 303);
        assert.ok(uploaded.headers.get("location")?.includes("uploaded"));
        const evidence = await db.projectEvidence.findFirstOrThrow({
          where: { projectId: project.id, taskId: task.id },
        });
        const download = await fetch(
          base + `/api/project-evidence/${evidence.id}`,
          { headers },
        );
        assert.equal(download.status, 200);
        assert.equal(
          download.headers.get("cache-control"),
          "private, no-store",
        );
      }
      const list = await fetch(base + "/projects", { headers });
      assert.equal(list.status, 200);
      const detail = await fetch(base + "/projects/" + project.id + "?tab=financial", { headers });
      assert.equal(detail.status, 200);
      const body = await detail.text();
      assert.equal(body.includes("Restricted project costs"), role === "OWNER");
      assert.ok(
        body.includes("Project progress") || body.includes("My task progress"),
      );
      assert.ok(body.includes("Main navigation"));
      assert.equal(
        (await fetch(base + "/owner/operations", { headers })).status,
        role === "OWNER" ? 200 : 404,
      );
      assert.equal(
        (await fetch(base + "/api/project-evidence/unknown", { headers }))
          .status,
        404,
      );
      const origin = await fetch(
        base + `/api/projects/${project.id}/evidence`,
        {
          method: "POST",
          headers: { ...headers, Origin: "https://attacker.invalid" },
          body: "invalid",
        },
      );
      assert.equal(origin.status, 403);
    }
    assert.equal(
      (await fetch(base + "/api/project-evidence/unknown")).status,
      401,
    );
    console.log(
      "Operations HTTP PASS: role pages, financial redaction, OWNER route, anonymous evidence and upload CSRF",
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error("Operations HTTP failed; no request headers or secrets logged");
  process.exitCode = 1;
});
