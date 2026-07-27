import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ALL_PERMISSIONS } from "@vercentlabs/permissions";

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
  const migrationDirectory = fileURLToPath(
    new URL("../../database/control-plane/migrations/", appRoot),
  );
  const migrations = readdirSync(migrationDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(migrationDirectory, name), "utf8"))
    .join("\n");

  const migratedPermissions = new Set(
    [
      ...migrations.matchAll(
        /\(\s*'([a-z][a-z0-9_-]*\.[a-z][a-z0-9_.-]*)'\s*,/g,
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
