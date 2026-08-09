import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("browser and mobile login use one anti-lockout policy", () => {
  const policy = read("src/lib/login-policy.ts");
  const browser = read("src/app/api/auth/login/route.ts");
  const mobile = read("src/app/api/mobile/v1/auth/login/route.ts");

  for (const route of [browser, mobile]) {
    assert.match(route, /enforceLoginRateLimits/);
    assert.match(route, /recordFailedPasswordAttempt/);
    assert.match(route, /recordSuccessfulLogin/);
    assert.match(route, /loginFailureReason/);
  }
  assert.match(policy, /login-credential:\$\{ipAddress\}:\$\{email\}/);
  assert.match(policy, /LEAST\(failed_login_attempts \+ 1, 1000000\)/);
  assert.doesNotMatch(policy, /locked_until\s*=\s*CASE/);
  assert.doesNotMatch(mobile, /mobile-login-email/);
  assert.doesNotMatch(mobile, /interval '15 minutes'/);
});

test("direct Sales routes render a permission-safe state instead of blank output", () => {
  const accessDenied = read("src/components/access-denied.tsx");
  const orders = read("src/app/(app)/sales/orders/page.tsx");
  const quotations = read("src/app/(app)/sales/quotations/page.tsx");

  assert.match(accessDenied, />Access denied</);
  for (const page of [orders, quotations]) {
    assert.match(page, /<AccessDenied/);
    assert.doesNotMatch(page, /return null/);
    assert.match(page, /PERMISSIONS\.salesView/);
  }
});
