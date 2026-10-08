import { test } from "node:test";
import assert from "node:assert/strict";
import {
  postZohoDelivery,
  prepareZohoDelivery,
} from "../src/sales-ai/providers/zoho-delivery";
import { deliveryBlock } from "../src/sales-ai/domain/delivery";
const input = {
  region: "US",
  accountId: "123",
  address: "owner@example.invalid",
  expectedRecipient: "owner@example.invalid",
  recipient: "owner@example.invalid",
  subject: "Re: Test",
  body: "Thank you for your inquiry.",
  replyToMessageId: "456",
};
test("default deployment gate rejects sending before HTTP and separates mailbox authorization", async () => {
  delete process.env.ZOHO_SEND_ENABLED;
  let calls = 0;
  await assert.rejects(
    postZohoDelivery(input, "synthetic-token", "key", undefined, async () => {
      calls++;
      throw new Error();
    }),
    /LIVE_DISABLED/,
  );
  assert.equal(calls, 0);
  assert.equal(deliveryBlock("ZOHO", true, true, true), "OUTBOUND_PAUSED");
  assert.equal(
    deliveryBlock("ZOHO", false, false, true),
    "WRITE_AUTH_REQUIRED",
  );
  assert.equal(deliveryBlock("ZOHO", false, true, true), "LIVE_DISABLED");
});
test("verified reply endpoint, one POST, plaintext and no invented provider idempotency header", async () => {
  process.env.ZOHO_SEND_ENABLED = "true";
  try {
    let calls = 0;
    const result = await postZohoDelivery(
      input,
      "synthetic-token",
      "local-idempotency",
      undefined,
      async (url, init) => {
        calls++;
        assert.equal(
          String(url),
          "https://mail.zoho.com/api/accounts/123/messages/456",
        );
        assert.equal(init?.redirect, "error");
        assert.equal(init?.method, "POST");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.action, "reply");
        assert.equal(body.mailFormat, "plaintext");
        assert.equal(body.toAddress, input.recipient);
        assert.equal(body.content, input.body);
        assert.ok(!body.ccAddress && !body.bccAddress && !body.isSchedule);
        assert.ok(!JSON.stringify(init?.headers).includes("Idempotency"));
        return Response.json({
          status: { code: 200 },
          data: { messageId: "789" },
        });
      },
    );
    assert.equal(calls, 1);
    assert.equal(result.messageId, "789");
    const ack = await postZohoDelivery(
      input,
      "synthetic-token",
      "key",
      undefined,
      async () => Response.json({ status: { code: 200 } }),
    );
    assert.equal(ack.messageId, "zoho-ack:key");
    const created = await postZohoDelivery(
      input,
      "synthetic-token",
      "created",
      undefined,
      async () => Response.json({ status: { code: 201 } }, { status: 201 }),
    );
    assert.equal(created.messageId, "zoho-ack:created");
  } finally {
    delete process.env.ZOHO_SEND_ENABLED;
  }
});
test("ambiguous failures and explicit rejections are distinct and never retried", async () => {
  process.env.ZOHO_SEND_ENABLED = "true";
  try {
    for (const [status, body, code] of [
      [401, "private-secret", "SEND_REJECTED"],
      [403, "private-secret", "SEND_REJECTED"],
      [429, "private-secret", "SEND_REJECTED"],
      [500, "private-secret", "SEND_UNCERTAIN"],
      [200, "invalid JSON", "SEND_UNCERTAIN"],
      [200, JSON.stringify({ status: { code: 500 } }), "SEND_UNCERTAIN"],
      [200, "x".repeat(70000), "SEND_UNCERTAIN"],
    ] as const) {
      let calls = 0;
      await assert.rejects(
        postZohoDelivery(
          input,
          "synthetic-token",
          "key",
          undefined,
          async () => {
            calls++;
            return new Response(body, { status });
          },
        ),
        new RegExp(code),
      );
      assert.equal(calls, 1);
    }
    let calls = 0;
    await assert.rejects(
      postZohoDelivery(input, "synthetic-token", "key", undefined, async () => {
        calls++;
        throw new Error("private-secret");
      }),
      /SEND_UNCERTAIN/,
    );
    assert.equal(calls, 1);
  } finally {
    delete process.env.ZOHO_SEND_ENABLED;
  }
});
test("recipient/header/path attacks are rejected before dispatch", () => {
  assert.throws(() =>
    prepareZohoDelivery({ ...input, recipient: "attacker@example.invalid" }),
  );
  assert.throws(() =>
    prepareZohoDelivery({
      ...input,
      subject: "Test\r\nBcc: attacker@example.invalid",
    }),
  );
  assert.throws(() =>
    prepareZohoDelivery({ ...input, replyToMessageId: "../other" }),
  );
  assert.equal(
    prepareZohoDelivery({ ...input, region: "EU" }).url,
    "https://mail.zoho.eu/api/accounts/123/messages/456",
  );
});
