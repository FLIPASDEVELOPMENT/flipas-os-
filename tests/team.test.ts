import { test } from "node:test";
import assert from "node:assert/strict";
import { createAccountInput, roleInput } from "../src/team/validation";
test("employee roles exclude OWNER and unknown roles", () => {
  for (const role of ["OWNER", "CUSTOMER", "SUPERUSER", "owner"])
    assert.equal(roleInput.safeParse(role).success, false);
  for (const role of ["ADMIN", "SALES", "PROJECT_MANAGER", "CREW"])
    assert.equal(roleInput.safeParse(role).success, true);
});
test("initial passwords require bounded length, confirmation and explicit fields", () => {
  const input = {
    name: " Crew ",
    email: "CREW@example.invalid",
    role: "CREW",
    password: "initial-test-strong-password",
    confirmation: "initial-test-strong-password",
  };
  assert.equal(createAccountInput.parse(input).email, "crew@example.invalid");
  assert.equal(createAccountInput.parse(input).name, "Crew");
  for (const patch of [
    { password: "short" },
    { confirmation: "not-matching-password" },
    { password: "x".repeat(257) },
    { active: true },
    { passwordHash: "bad" },
    { role: "OWNER" },
  ])
    assert.equal(
      createAccountInput.safeParse({ ...input, ...patch }).success,
      false,
    );
});
