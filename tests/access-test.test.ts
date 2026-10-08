import { test } from "node:test";
import assert from "node:assert/strict";
import { accessTestMessage } from "../src/sales-ai/domain/access-test";

test("Access test errors give actionable messages without echoing provider secrets", () => {
  for (const code of ["ACCOUNT_MISMATCH", "WRITE_AUTH_REQUIRED", "TOKEN_REFRESH_FAILED", "AUTH_REQUIRED", "ACCESS_DENIED", "RATE_LIMIT"]) {
    assert.ok(accessTestMessage(code).length > 30);
  }
  assert.match(accessTestMessage("ACCOUNT_MISMATCH"), /different mailbox/);
  assert.match(accessTestMessage("ACCESS_DENIED"), /permissions/);
  assert.ok(!accessTestMessage("OAuth=secret; cookie=private").includes("private"));
  assert.equal(accessTestMessage(null), accessTestMessage("unknown"));
});
