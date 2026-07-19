import assert from "node:assert/strict";
import fs from "node:fs";

const required = [
  "apps/mobile/package.json",
  "apps/mobile/app.config.ts",
  "apps/mobile/app/_layout.tsx",
  "apps/mobile/app/(auth)/login.tsx",
  "apps/mobile/app/(app)/_layout.tsx",
  "apps/mobile/src/auth/auth-provider.tsx",
  "apps/mobile/src/data/database.ts",
  "apps/mobile/src/theme/tokens.ts",
  "apps/web/src/app/api/mobile/v1/auth/login/route.ts",
  "apps/web/src/app/api/mobile/v1/auth/refresh/route.ts",
  "apps/web/src/app/api/mobile/v1/session/route.ts",
  "database/control-plane/migrations/011_mobile_sessions.sql",
  "packages/shared-sdk/src/mobile.js",
  "apps/mobile/src/api/client.ts",
  "apps/mobile/src/data/use-crm-query.ts",
  "apps/mobile/src/ui/crm-list-screen.tsx",
  "apps/mobile/src/ui/crm-states.tsx",
  "apps/web/src/app/api/mobile/v1/crm/dashboard/route.ts",
  "apps/web/src/app/api/mobile/v1/crm/[resource]/route.ts",
  "apps/mobile/src/data/sync.ts",
  "apps/mobile/src/features/leads/lead-capture.tsx",
  "apps/web/src/app/api/mobile/v1/crm/activities/[id]/complete/route.ts",
  "apps/web/src/app/api/mobile/v1/crm/opportunities/[id]/stage/route.ts",
  "apps/web/src/lib/mobile-idempotency.ts",
  "apps/mobile/app/(app)/search.tsx",
  "apps/mobile/app/(app)/notifications.tsx",
  "apps/mobile/src/security/privacy-shield.tsx",
  "apps/mobile/src/ui/app-error-boundary.tsx",
  "apps/mobile/eas.json",
  "apps/mobile/STORE_RELEASE.md",
  "apps/web/src/app/api/mobile/v1/search/route.ts",
  "apps/web/src/app/api/mobile/v1/notifications/route.ts",
];

for (const file of required) {
  assert.ok(fs.existsSync(file), `Missing mobile foundation file: ${file}`);
  assert.ok(
    fs.statSync(file).size > 80,
    `Mobile foundation file is empty: ${file}`,
  );
}

const packageJson = JSON.parse(
  fs.readFileSync("apps/mobile/package.json", "utf8"),
);
assert.match(packageJson.dependencies.expo, /^~57\./);
assert.equal(packageJson.dependencies["@vercent/shared-sdk"], "workspace:*");
assert.ok(packageJson.scripts.typecheck);
assert.ok(packageJson.scripts.lint);
assert.ok(packageJson.scripts.test);

const imports = required
  .filter((file) => file.startsWith("apps/mobile/") && /\.[tj]sx?$/.test(file))
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");
assert.doesNotMatch(imports, /from ["'][^"']*apps\/web/);
assert.doesNotMatch(imports, /from ["'][^"']*services\/api/);

for (const screen of ["index", "leads", "pipeline", "activities"]) {
  const source = fs.readFileSync(`apps/mobile/app/(app)/${screen}.tsx`, "utf8");
  assert.doesNotMatch(source, /FoundationScreen/, `${screen} is still a placeholder`);
}

const sdk = fs.readFileSync("packages/shared-sdk/src/mobile.js", "utf8");
assert.match(sdk, /crmDashboard/);
assert.match(sdk, /listCrm/);
assert.match(sdk, /createCrm/);
assert.match(sdk, /completeActivity/);
assert.match(sdk, /moveOpportunity/);

console.log(
  `Mobile foundation verified (${required.length} required artifacts).`,
);
