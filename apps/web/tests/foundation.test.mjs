import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("verification flow includes resend and token-aware continuation", () => {
  assert.match(
    read("src/app/(auth)/verify-email/page.tsx"),
    /ResendVerificationForm/,
  );
  assert.match(read("src/app/api/auth/verify-email/route.ts"), /createSession/);
  assert.ok(
    fs.existsSync(
      path.join(root, "src/app/api/auth/resend-verification/route.ts"),
    ),
  );
});

test("password reset returns to login and invalidates sessions", () => {
  const source = read("src/app/api/auth/reset-password/route.ts");
  assert.match(source, /UPDATE sessions SET revoked_at/);
  assert.match(source, /next: "\/login/);
  assert.doesNotMatch(source, /setSessionCookie/);
});

test("platform schema includes access, audit and shared services", () => {
  const sql = read(
    "../../database/control-plane/migrations/002_platform_foundation.sql",
  );
  for (const table of [
    "roles",
    "role_permissions",
    "departments",
    "cost_centers",
    "teams",
    "notifications",
    "numbering_series",
    "organization_modules",
    "approval_requests",
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
});
