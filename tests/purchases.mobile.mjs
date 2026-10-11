import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { db } from "../src/server/db.ts";
import { tokenHash } from "../src/server/auth.ts";
import { sample } from "./purchases.fixture.ts";
import { importCSV } from "../src/purchases/service.ts";

if (!new URL(process.env.DATABASE_URL).pathname.endsWith("_test"))
  throw new Error("Disposable *_test database required");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
let browser;
try {
  const base = process.env.SMOKE_BASE_URL;
  assert.ok(base);
  const owner = await db.user.create({
    data: {
      role: "OWNER",
      name: "Browser purchase test",
      email: randomUUID() + "@example.invalid",
      passwordHash: "not-login",
    },
  });
  const imported = await importCSV(
    owner,
    "browser.csv",
    sample({ external_id: randomUUID(), receipt_id: randomUUID() }),
  );
  const purchase = await db.importedPurchase.findFirstOrThrow({
    where: { documentId: imported.documentId },
  });
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      userId: owner.id,
      tokenHash: tokenHash(token),
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
    headless: true,
  });
  {
    const context = await browser.newContext({
      viewport: { width: 430, height: 850 },
    });
    await context.addCookies([
      { name: "flipas_session", value: token, url: base },
    ]);
    const page = await context.newPage();
    const before = await db.importedPurchase.count(),
      costs = await db.projectCostEntry.count();
    await page.goto(base + "/owner/purchases");
    await page
      .locator('input[type="file"]')
      .setInputFiles({
        name: "native.csv",
        mimeType: "text/csv",
        buffer: readFileSync(
          new URL(
            "../docs/examples/home-depot-pro-xtra-synthetic.csv",
            import.meta.url,
          ),
        ),
      });
    await page.getByRole("button", { name: "Preview CSV import" }).click();
    await page.waitForURL(/\/owner\/purchases\/imports\//);
    assert.ok(
      (await page.locator("body").innerText()).includes("3 valid rows"),
    );
    assert.ok(
      (await page.locator("body").innerText()).includes(
        "2 unsupported/ambiguous",
      ),
    );
    assert.equal(await db.importedPurchase.count(), before);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    );
    await page.locator('input[name="confirmation"]').check();
    await page
      .getByRole("button", { name: "Confirm import — no costs recorded" })
      .click();
    await page.waitForURL(/notice=/);
    assert.equal(await db.importedPurchase.count(), before + 5);
    assert.equal(await db.projectCostEntry.count(), costs);
    console.log(
      "Home Depot browser PASS: upload → preview → explicit confirmation; returns blocked; zero costs",
    );
    await context.close();
  }
  for (const width of [375, 390, 430, 1280]) {
    const context = await browser.newContext({
      viewport: { width, height: 850 },
    });
    await context.addCookies([
      { name: "flipas_session", value: token, url: base },
    ]);
    const page = await context.newPage();
    await page.goto(base + "/owner/purchases/" + purchase.id);
    await page.getByRole("button", { name: "Add split allocation" }).click();
    assert.equal(
      await page
        .locator('input[name="allocations"]')
        .evaluate((el) => JSON.parse(el.value).length),
      2,
    );
    await page
      .getByRole("button", { name: "Remove allocation" })
      .last()
      .click();
    await page
      .getByLabel(/Project or company expense/)
      .selectOption("__overhead");
    await page
      .getByLabel("Review / correction reason", { exact: true })
      .fill("Browser verifies manual review only");
    assert.equal(
      await page.getByLabel(/^Category/).inputValue(),
      "General Overhead",
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      "No page-level horizontal overflow at " + width,
    );
    if (width === 430) {
      await page
        .getByRole("button", { name: "Save classification for review" })
        .click();
      await page.waitForURL(/notice=/);
      const saved = await db.importedPurchase.findUniqueOrThrow({
        where: { id: purchase.id },
      });
      assert.equal(saved.status, "NEEDS_REVIEW");
      assert.equal(saved.headVersion, 1);
      assert.equal(
        await db.purchasePosting.count({ where: { purchaseId: purchase.id } }),
        0,
      );
    }
    console.log(
      "Purchases browser PASS: OWNER review controls at " + width + "px",
    );
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  await db.$disconnect();
}
