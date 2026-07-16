import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ALL_PERMISSIONS } from "@vercent/permissions";

const appRoot = new URL("../", import.meta.url);

function read(relativePath) {
  return readFileSync(new URL(relativePath, appRoot), "utf8");
}

function filesBelow(directory, name) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesBelow(path, name);
    return entry.name === name ? [path] : [];
  });
}

test("the shared permission registry covers every migrated permission", () => {
  const migrations = [
    "database/control-plane/migrations/001_auth_and_onboarding.sql",
    "database/control-plane/migrations/002_platform_foundation.sql",
    "database/control-plane/migrations/003_business_data_permissions.sql",
    "database/control-plane/migrations/004_crm_permissions.sql",
    "database/control-plane/migrations/005_billing_and_razorpay.sql",
    "database/control-plane/migrations/006_crm_enterprise_permissions.sql",
  ]
    .map((path) => read("../../" + path))
    .join("\n");

  const migratedPermissions = new Set(
    [
      ...migrations.matchAll(
        /'([a-z][a-z0-9_.-]+\.(?:view|manage|import|export|checkout|audit))'/g,
      ),
    ].map((match) => match[1]),
  );

  assert.deepEqual(
    [...new Set(ALL_PERMISSIONS)].sort(),
    [...migratedPermissions].sort(),
  );
  assert.match(read("src/lib/platform.ts"), /ALL_PERMISSIONS/);
});

test("mutating routes validate JSON before charging API usage", () => {
  const apiRoot = fileURLToPath(new URL("src/app/api/", appRoot));
  const routeFiles = filesBelow(apiRoot, "route.ts");

  for (const path of routeFiles) {
    const source = readFileSync(path, "utf8");
    const validation = source.indexOf("readJson(request)");
    const charge = source.indexOf(
      'await incrementBillingUsage(session.organizationId, "api_requests_monthly")',
    );
    if (validation >= 0 && charge >= 0) {
      assert.ok(validation < charge, path);
    }
  }

  const publicCapture = read("src/app/api/crm/public/capture/[key]/route.ts");
  assert.ok(
    publicCapture.indexOf("readJson(request)") <
      publicCapture.indexOf(
        'await incrementBillingUsage(organizationId, "api_requests_monthly")',
      ),
  );
});
