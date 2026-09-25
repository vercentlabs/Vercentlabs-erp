#!/usr/bin/env node
// Static Shared Access architecture gate (part of `pnpm verify:access`).
// Pure rules live in architecture-rules.mjs; this driver only collects
// tracked source files and reports. No database, no network.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ALL_PERMISSIONS } from "../../packages/permissions/src/index.js";
import { ERP_MODULE_CATALOG } from "../../packages/shared-types/src/modules.js";
import { verifyLock } from "../access/role-template-lock.mjs";
import {
  checkAccessBoundaryUse,
  checkAccessStateWriters,
  checkAdminRoutesUseWorkspaceRoute,
  checkCompanyAdministratorTemplate,
  checkInvitationWrites,
  checkRetiredDefinitions,
  checkCanonicalDefinitions,
  checkClientTenantIdentity,
  checkModuleCatalogueCopies,
  checkPermissionLiterals,
  checkTenantContextSetters,
  checkWebDatabaseAccess,
} from "./architecture-rules.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const tracked = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((file) => fs.existsSync(path.join(root, file)));

const SOURCE = /\.(?:m?js|cjs|tsx?)$/;
const inScope = (file) =>
  SOURCE.test(file) &&
  /^(apps\/web\/src|services\/api\/src|services\/worker\/src|packages\/[^/]+\/src)\//.test(file) &&
  !file.startsWith("docs/");
const files = tracked.filter(inScope).map((file) => ({ path: file, source: fs.readFileSync(path.join(root, file), "utf8") }));

const sections = [
  ["canonical security primitives and registries are defined once", checkCanonicalDefinitions(files)],
  ["tenant context is only set through @vercentlabs/database", checkTenantContextSetters(files)],
  ["web code reaches the database only through core/db.ts", checkWebDatabaseAccess(files)],
  ["every checked permission is registered in @vercentlabs/permissions", checkPermissionLiterals(files, ALL_PERMISSIONS)],
  ["organizationId is never read from request input", checkClientTenantIdentity(files)],
  ["Shared Access is consumed through its public boundary", checkAccessBoundaryUse(files)],
  ["no second module catalogue", checkModuleCatalogueCopies(files, ERP_MODULE_CATALOG.map((module) => module.key))],
  ["built-in role templates match their synchronization lock", verifyLock()],
  ["Company Administrator is an explicit least-privilege allow-list", checkCompanyAdministratorTemplate(fs.readFileSync(path.join(root, "packages/permissions/src/roles.js"), "utf8"))],
  ["access state (modules, user scope, invitations) has one canonical writer each", checkAccessStateWriters(files)],
  ["invitations are written through the normalized canonical tables", checkInvitationWrites(files)],
  ["superseded access mutations stay retired", checkRetiredDefinitions(files)],
  ["Shared Access administration routes use workspaceRoute()", checkAdminRoutesUseWorkspaceRoute(files)],
];

let failures = 0;
for (const [label, problems] of sections) {
  if (problems.length) {
    failures += problems.length;
    for (const problem of problems) console.error(`FAIL  ${problem}`);
  } else {
    console.log(`OK    ${label}`);
  }
}
if (failures) {
  console.error(`\n${failures} Shared Access architecture failure(s). See docs/01-standards/SHARED_PLATFORM_ARCHITECTURE.md.`);
  process.exit(1);
}
console.log(`OK    ${files.length} source files checked`);
