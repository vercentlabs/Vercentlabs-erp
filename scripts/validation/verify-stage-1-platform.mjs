import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const failures = [];

function requireMatch(file, pattern, message) {
  const source = read(file);
  if (!pattern.test(source)) failures.push(`${file}: ${message}`);
}

function forbidMatch(file, pattern, message) {
  const source = read(file);
  if (pattern.test(source)) failures.push(`${file}: ${message}`);
}

for (const route of [
  "apps/web/src/app/api/auth/login/route.ts",
  "apps/web/src/app/api/mobile/v1/auth/login/route.ts",
]) {
  requireMatch(
    route,
    /enforceLoginRateLimits/,
    "must use the shared login rate-limit policy",
  );
  requireMatch(
    route,
    /recordFailedPasswordAttempt/,
    "must use the shared failed-password recorder",
  );
  requireMatch(
    route,
    /recordSuccessfulLogin/,
    "must use the shared successful-login reset",
  );
}

requireMatch(
  "apps/web/src/lib/login-policy.ts",
  /login-credential:\$\{ipAddress\}:\$\{email\}/,
  "credential limits must be scoped to both IP and email",
);
forbidMatch(
  "apps/web/src/lib/login-policy.ts",
  /locked_until\s*=\s*CASE/,
  "anonymous failures must not create global locks",
);
forbidMatch(
  "apps/web/src/app/api/mobile/v1/auth/login/route.ts",
  /mobile-login-email|interval '15 minutes'/,
  "the native route still contains the old lockout behaviour",
);

for (const page of [
  "apps/web/src/app/(app)/sales/orders/page.tsx",
  "apps/web/src/app/(app)/sales/quotations/page.tsx",
]) {
  requireMatch(page, /<AccessDenied/, "must render an explicit denial state");
  forbidMatch(page, /return null/, "must not silently render a blank page");
}

const live = "apps/landing/scripts/verify-platform-live.mjs";
requireMatch(live, /new pg\.Pool/, "must execute against PostgreSQL");
requireMatch(live, /mobile_idempotency_keys/, "must verify idempotency claims");
requireMatch(live, /chromium\.launch/, "must execute a real browser journey");
requireMatch(
  live,
  /api\/mobile\/v1\/auth\/login/,
  "must test the native login endpoint",
);
requireMatch(
  live,
  /getByRole\("heading", \{ name: "Access denied" \}\)/,
  "must verify direct-route authorization feedback",
);

requireMatch(
  ".github/workflows/release-readiness.yml",
  /pnpm test:platform-live/,
  "CI must run the live Stage 1 test",
);
requireMatch(
  ".github/workflows/release-readiness.yml",
  /pnpm lint:mobile && pnpm typecheck:mobile/,
  "CI must enforce native lint and type checking",
);
requireMatch(
  ".github/workflows/release-readiness.yml",
  /pnpm format:check/,
  "CI must enforce formatting",
);

const packageJson = JSON.parse(read("package.json"));
for (const script of [
  "test:platform-live",
  "format:check",
  "verify:stage-1",
  "release:gate:live",
]) {
  if (!packageJson.scripts?.[script]) {
    failures.push(`package.json: missing ${script} script`);
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(
  "Stage 1 platform contract verified: shared login policy, explicit authorization feedback, live PostgreSQL/browser proof and CI enforcement.",
);
