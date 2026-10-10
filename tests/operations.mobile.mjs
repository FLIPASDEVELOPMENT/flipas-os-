import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { db } from "../src/server/db.ts";
import { tokenHash } from "../src/server/auth.ts";

if (!new URL(process.env.DATABASE_URL).pathname.endsWith("_test"))
  throw new Error("Disposable *_test database required");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.SMOKE_BASE_URL;
assert.ok(base, "SMOKE_BASE_URL is required");
const screenshots =
  process.env.MOBILE_SCREENSHOTS_DIR || "/tmp/flipas-mobile-review";
let browser;
try {
  await mkdir(screenshots, { recursive: true });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    headless: true,
  });
  const project = await db.project.findFirstOrThrow({
    orderBy: { createdAt: "desc" },
  });
  for (const role of ["OWNER", "PROJECT_MANAGER", "CREW"]) {
    const user = await db.user.create({
      data: {
        role,
        name: `Mobile ${role}`,
        email: randomBytes(12).toString("hex") + "@example.invalid",
        passwordHash: "not-login",
      },
    });
    await db.projectMember.create({
      data: { projectId: project.id, userId: user.id },
    });
    const token = randomBytes(32).toString("hex");
    await db.session.create({
      data: {
        userId: user.id,
        tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() + 600000),
      },
    });
    const task = await db.projectTask.create({
      data: {
        projectId: project.id,
        assigneeId: user.id,
        title: `Assigned ${role}: cabinet installation and finishing`,
        progress: 35,
      },
    });
    await db.projectChecklist.createMany({
      data: [
        "Verify substrate",
        "Photograph installation",
        "Inspect finish",
      ].map((title) => ({ projectId: project.id, taskId: task.id, title })),
    });
    const context = await browser.newContext();
    await context.addCookies([
      { name: "flipas_session", value: token, url: base },
    ]);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const width of [375, 390, 430, 1280]) {
      await page.setViewportSize({ width, height: 932 });
      await page.goto(`${base}/projects/${project.id}`, {
        waitUntil: "networkidle",
      });
      const mobile = width < 800;
      const menu = page.locator(".mobile-menu-toggle");
      const selector = page.locator("#project-section-select");
      assert.equal(await menu.isVisible(), mobile);
      assert.equal(await selector.isVisible(), mobile);
      if (mobile) {
        const header = await page.locator(".sidebar").boundingBox();
        assert.ok(
          header && header.height <= 70,
          "Collapsed mobile header must stay compact even on short pages",
        );
        assert.equal(await menu.getAttribute("aria-expanded"), "false");
        assert.equal(
          await page
            .getByRole("navigation", { name: "Main navigation" })
            .isVisible(),
          false,
        );
        await menu.click();
        assert.equal(await menu.getAttribute("aria-expanded"), "true");
        assert.equal(
          await page
            .getByRole("navigation", { name: "Main navigation" })
            .isVisible(),
          true,
        );
        if (role === "CREW")
          assert.equal(
            await page
              .getByRole("link", { name: "Estimates", exact: true })
              .count(),
            0,
          );
        await page.getByRole("button", { name: /^Close menu / }).click();
        const options = await selector
          .locator("option")
          .evaluateAll((items) => items.map((item) => item.value));
        assert.equal(options.includes("financial"), role === "OWNER");
        for (const option of options) {
          await selector.selectOption(option);
          await page
            .locator(`.project-tab-panel #${option}`)
            .waitFor({ state: "visible" });
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
            false,
            `Overflow ${role}/${width}/${option}`,
          );
        }
        await selector.selectOption("tasks");
      } else {
        await page
          .getByRole("navigation", { name: "Project sections" })
          .getByRole("button", { name: "Tasks", exact: true })
          .click();
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      const card = page.locator(".task-card").filter({ hasText: task.title });
      await card.waitFor({ state: "visible" });
      if (role === "CREW") {
        assert.equal(await page.locator(".task-card").count(), 1);
        if (mobile) {
          const action = await card
            .getByText("Record progress", { exact: true })
            .boundingBox();
          assert.ok(
            action && action.y >= 0 && action.y < 650,
            "Main task action must be reachable without a long scroll",
          );
          await page
            .getByRole("button", { name: "My hours", exact: true })
            .click();
          await page.locator("#crew").waitFor({ state: "visible" });
          await page
            .getByRole("button", { name: "Report incident", exact: true })
            .click();
          await page.locator("#logs").waitFor({ state: "visible" });
          await page
            .getByRole("button", { name: "My tasks", exact: true })
            .click();
        }
      }
      assert.equal(
        await card.locator(".evidence-form").getAttribute("open"),
        null,
      );
      await card.getByText("Record progress", { exact: true }).click();
      assert.ok(await card.locator('input[name="progress"]').isVisible());
      await card.getByText("Record progress", { exact: true }).click();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `${screenshots}/${role.toLowerCase()}-${width}.png`,
        fullPage: true,
      });
      assert.deepEqual(errors, [], "No hydration or client errors");
      console.log(`Mobile navigation PASS: ${role} at ${width}px`);
    }
    await context.close();
  }
} finally {
  await browser?.close();
  await db.$disconnect();
}
