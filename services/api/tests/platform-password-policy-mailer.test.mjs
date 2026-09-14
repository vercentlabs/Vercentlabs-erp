import assert from "node:assert/strict";
import test from "node:test";

import { passwordPolicyIssues } from "../src/core/password-policy.js";
import { deliverAuthMessage } from "../src/core/auth-mailer.js";

test("passwordPolicyIssues rejects short, all-numeric, letter-or-number-missing, and email-containing passwords", () => {
  assert.ok(passwordPolicyIssues("short1").length > 0);
  assert.ok(passwordPolicyIssues("123456789012").length > 0);
  assert.ok(passwordPolicyIssues("alllettersnonumber").length > 0);
  assert.ok(
    passwordPolicyIssues("passwordwithuser@example.com1", { email: "user@example.com" }).length > 0,
  );
});

test("passwordPolicyIssues accepts a reasonable strong password", () => {
  assert.deepEqual(passwordPolicyIssues("Correct-Horse-Battery-42", { email: "someone@example.com" }), []);
});

test("deliverAuthMessage returns false (not throw) when neither SMTP nor a webhook is configured, rather than silently pretending success", async () => {
  const delivered = await deliverAuthMessage(
    { type: "verify-email", email: "user@example.com", url: "https://app.example.com/verify?token=x" },
    { NODE_ENV: "test" },
  );
  assert.equal(delivered, false);
});

test("deliverAuthMessage throws when SMTP configuration is present but incomplete, rather than silently downgrading to no-op", async () => {
  await assert.rejects(
    deliverAuthMessage(
      { type: "verify-email", email: "user@example.com", url: "https://app.example.com/verify?token=x" },
      { SMTP_HOST: "smtp.example.com" }, // missing user/password/from
    ),
  );
});
