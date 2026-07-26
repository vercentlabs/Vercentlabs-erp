import assert from "node:assert/strict";
import fs from "node:fs";

const required = [
  ".gitignore",
  "apps/mobile/package.json",
  "apps/mobile/app.config.ts",
  "apps/mobile/src/app/_layout.tsx",
  "apps/mobile/src/app/index.tsx",
  "apps/mobile/src/app/(auth)/login.tsx",
  "apps/mobile/src/app/(protected)/(tabs)/_layout.tsx",
  "apps/mobile/src/app/(protected)/(tabs)/index.tsx",
  "apps/mobile/src/app/(protected)/(tabs)/leads.tsx",
  "apps/mobile/src/app/(protected)/(tabs)/pipeline.tsx",
  "apps/mobile/src/app/(protected)/(tabs)/activities.tsx",
  "apps/mobile/src/app/(protected)/crm/[resource]/[id].tsx",
  "apps/mobile/src/app/(protected)/search.tsx",
  "apps/mobile/src/app/(protected)/notifications.tsx",
  "apps/mobile/src/core/api/client.ts",
  "apps/mobile/src/core/auth/auth-provider.tsx",
  "apps/mobile/src/core/auth/token-store.ts",
  "apps/mobile/src/core/database/database.ts",
  "apps/mobile/src/core/modules/registry.ts",
  "apps/mobile/src/core/providers/app-providers.tsx",
  "apps/mobile/src/core/security/privacy-shield.tsx",
  "apps/mobile/src/shared/theme/tokens.ts",
  "apps/mobile/src/shared/components/app-error-boundary.tsx",
  "apps/mobile/src/shared/components/crm-list-screen.tsx",
  "apps/mobile/src/shared/components/crm-states.tsx",
  "apps/mobile/src/modules/crm/components/lead-capture.tsx",
  "apps/mobile/src/modules/crm/data/sync.ts",
  "apps/mobile/src/modules/crm/hooks/use-crm-query.ts",
  "apps/mobile/src/modules/crm/manifest.ts",
  "apps/web/src/app/api/mobile/v1/auth/login/route.ts",
  "apps/web/src/app/api/mobile/v1/auth/refresh/route.ts",
  "apps/web/src/app/api/mobile/v1/session/route.ts",
  "database/control-plane/migrations/011_mobile_sessions.sql",
  "packages/shared-sdk/src/mobile.js",
  "apps/web/src/app/api/mobile/v1/crm/dashboard/route.ts",
  "apps/web/src/app/api/mobile/v1/crm/[resource]/route.ts",
  "apps/web/src/app/api/mobile/v1/crm/[resource]/[id]/route.ts",
  "apps/web/src/app/api/mobile/v1/crm/activities/[id]/complete/route.ts",
  "apps/web/src/app/api/mobile/v1/crm/opportunities/[id]/stage/route.ts",
  "apps/web/src/lib/mobile-idempotency.ts",
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

for (const asset of [
  "apps/mobile/assets/app-icon.png",
  "apps/mobile/assets/splash-icon.png",
  "apps/mobile/assets/brand-logo.png",
]) {
  assert.ok(fs.existsSync(asset), `Missing mobile release asset: ${asset}`);
  assert.ok(fs.statSync(asset).size > 80, `Mobile release asset is empty: ${asset}`);
}

const packageJson = JSON.parse(
  fs.readFileSync("apps/mobile/package.json", "utf8"),
);
assert.match(packageJson.dependencies.expo, /^~57\./);
assert.equal(packageJson.dependencies["@vercentlabs/shared-sdk"], "workspace:*");
assert.ok(packageJson.scripts.typecheck);
assert.ok(packageJson.scripts.lint);
assert.ok(packageJson.scripts.test);
assert.match(packageJson.scripts.android, /expo prebuild --clean --platform android/);
assert.equal(packageJson.dependencies["react-dom"], packageJson.dependencies.react);
assert.match(packageJson.dependencies["expo-system-ui"], /^~57\./);
assert.notEqual(
  packageJson.expo?.doctor?.appConfigFieldsNotSyncedCheck?.enabled,
  false,
  "Expo native configuration drift checks must not be disabled",
);

const gitignore = fs.readFileSync(".gitignore", "utf8");
assert.match(gitignore, /^apps\/mobile\/android\/$/m);
assert.match(gitignore, /^apps\/mobile\/ios\/$/m);

const imports = required
  .filter((file) => file.startsWith("apps/mobile/") && /\.[tj]sx?$/.test(file))
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");
assert.doesNotMatch(imports, /from ["'][^"']*apps\/web/);
assert.doesNotMatch(imports, /from ["'][^"']*services\/api/);
assert.doesNotMatch(imports, /react-native-webview|<WebView/);

for (const screen of ["index", "leads", "pipeline", "activities"]) {
  const source = fs.readFileSync(
    `apps/mobile/src/app/(protected)/(tabs)/${screen}.tsx`,
    "utf8",
  );
  assert.doesNotMatch(source, /FoundationScreen/, `${screen} is still a placeholder`);
}

const authProvider = fs.readFileSync(
  "apps/mobile/src/core/auth/auth-provider.tsx",
  "utf8",
);
assert.match(authProvider, /import \{ mobileApi \}/);
assert.doesNotMatch(authProvider, /createMobileClient/);
assert.match(authProvider, /bindOfflineWorkspace/);

const database = fs.readFileSync(
  "apps/mobile/src/core/database/database.ts",
  "utf8",
);
assert.match(database, /workspace-owner/);

const providers = fs.readFileSync(
  "apps/mobile/src/core/providers/app-providers.tsx",
  "utf8",
);
assert.match(providers, /auth\.status === "signed-in"/);

const sdk = fs.readFileSync("packages/shared-sdk/src/mobile.js", "utf8");
assert.match(sdk, /crmDashboard/);
assert.match(sdk, /listCrm/);
assert.match(sdk, /getCrm/);
assert.match(sdk, /updateCrm/);
assert.match(sdk, /createCrm/);
assert.match(sdk, /completeActivity/);
assert.match(sdk, /moveOpportunity/);

console.log(
  `Mobile foundation verified (${required.length} required artifacts).`,
);
