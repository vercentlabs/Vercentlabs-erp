import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("browser and mobile login use one anti-lockout policy", () => {
  const policy = read("apps/web/src/lib/login-policy.ts");
  const browser = read("apps/web/src/app/api/auth/login/route.ts");
  const mobile = read("apps/web/src/app/api/mobile/v1/auth/login/route.ts");

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
  const accessDenied = read("apps/web/src/components/access-denied.tsx");
  const orders = read("apps/web/src/app/(app)/sales/orders/page.tsx");
  const quotations = read("apps/web/src/app/(app)/sales/quotations/page.tsx");

  assert.match(accessDenied, />Access denied</);
  for (const page of [orders, quotations]) {
    assert.match(page, /<AccessDenied/);
    assert.doesNotMatch(page, /return null/);
    assert.match(page, /PERMISSIONS\.salesView/);
  }
});

test("Stage 1 includes an executable PostgreSQL and browser verification", () => {
  const live = read("apps/landing/scripts/verify-platform-live.mjs");
  const workflow = read(".github/workflows/release-readiness.yml");
  const rootPackage = JSON.parse(read("package.json"));

  assert.match(live, /new pg\.Pool/);
  assert.match(live, /Promise\.all/);
  assert.match(live, /mobile_idempotency_keys/);
  assert.match(live, /chromium\.launch/);
  assert.match(live, /api\/mobile\/v1\/auth\/login/);
  assert.match(live, /getByRole\("heading", \{ name: "Access denied" \}\)/);
  assert.match(workflow, /pnpm test:platform-live/);
  assert.match(workflow, /pnpm lint:mobile && pnpm typecheck:mobile/);
  assert.equal(
    rootPackage.scripts["test:platform-live"],
    "corepack pnpm --filter @vercentlabs/landing test:platform-live",
  );
});
