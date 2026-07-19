import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

const requiredFiles = [
  ".github/workflows/release-readiness.yml",
  ".dockerignore",
  "database/control-plane/migrations/009_crm_release_scope.sql",
  "database/control-plane/migrations/010_approval_execution.sql",
  "database/control-plane/migrations/011_mobile_sessions.sql",
  "database/tenant/migrations/006_crm_release_foundation.sql",
  "database/tenant/migrations/007_crm_outbox_leases.sql",
  "docs/testing/manual-crm-acceptance.md",
  "docs/deployment/crm-production-runbook.md",
  "infrastructure/docker/Dockerfile.web",
  "infrastructure/docker/Dockerfile.landing",
  "infrastructure/docker/Dockerfile.migration",
  "infrastructure/docker/Dockerfile.worker",
  "infrastructure/docker/compose.production.example.yml",
  "scripts/database/backup-postgres.sh",
  "scripts/database/restore-postgres.sh",
  "scripts/deployment/validate-production-env.mjs",
  "scripts/deployment/smoke-deployment.mjs",
];
for (const file of requiredFiles) {
  if (!exists(file)) failures.push(`Required release file missing: ${file}`);
}

function requireMarkers(file, markers) {
  const source = read(file);
  for (const marker of markers) {
    if (!source.includes(marker)) failures.push(`${file} is missing: ${marker}`);
  }
}

requireMarkers("apps/web/src/app/api/readiness/route.ts", [
  '"011_mobile_sessions.sql"',
  '"007_crm_outbox_leases.sql"',
  "schema_migrations WHERE name = $1",
  "tenant_schema_migrations WHERE name = $2",
]);

const platform = read("apps/web/src/lib/platform.ts");
const moduleCatalogSource = read("packages/shared-types/src/modules.js");
const moduleEntries = [...moduleCatalogSource.matchAll(
  /\{\s*key:\s*"([^"]+)"[\s\S]*?availability:\s*"([^"]+)"[\s\S]*?\}/g,
)].map((match) => ({ key: match[1], availability: match[2] }));
const releasedModules = moduleEntries
  .filter((entry) => entry.availability === "released")
  .map((entry) => entry.key);
if (releasedModules.length !== 1 || releasedModules[0] !== "crm") {
  failures.push("CRM must be the only released module in ERP_MODULE_CATALOG.");
}
for (const marker of [
  "seedCrmFoundation",
  '"crm_lead"',
  '"crm_opportunity"',
  '"crm_campaign"',
  '"crm_activity"',
  "await seedCrmFoundation(client, input)",
]) {
  if (!platform.includes(marker)) failures.push(`CRM onboarding foundation missing: ${marker}`);
}

requireMarkers("apps/web/src/app/api/modules/[key]/route.ts", [
  'moduleEntry.availability !== "released"',
  "cannot be activated in this release",
  "CRM is the released product and cannot be disabled",
  "assertModuleEntitlement",
]);

requireMarkers("apps/web/src/app/api/crm/[resource]/import/route.ts", [
  "SAVEPOINT",
  "ROLLBACK TO SAVEPOINT",
  "RELEASE SAVEPOINT",
]);

for (const file of [
  "apps/web/src/app/(app)/crm/leads/[id]/page.tsx",
  "apps/web/src/app/(app)/crm/opportunities/[id]/page.tsx",
  "apps/web/src/app/(app)/crm/pipeline/page.tsx",
]) {
  requireMarkers(file, ["PERMISSIONS.crmView", "notFound()"]);
}

requireMarkers("apps/web/src/app/(app)/search/page.tsx", [
  "PERMISSIONS.crmView",
  "PERMISSIONS.businessDataView",
  "tenantTransaction",
  "listCrmRecords",
  "listBusinessDataRecords",
]);

requireMarkers("services/api/src/crm.js", [
  "validateOrganizationUserReferences",
  "organization_memberships",
  "CRM owners and assignees must be active members of this organization.",
]);

requireMarkers("apps/landing/src/lib/lead-delivery.ts", [
  "CRM_CAPTURE_PROXY_SECRET",
  "X-Vercent-Capture-Timestamp",
  "X-Vercent-Capture-Fingerprint",
  "X-Vercent-Capture-Signature",
]);
requireMarkers("apps/web/src/app/api/crm/public/capture/[key]/route.ts", [
  "CRM_CAPTURE_PROXY_SECRET",
  "x-vercent-capture-timestamp",
  "x-vercent-capture-fingerprint",
  "x-vercent-capture-signature",
]);
requireMarkers("apps/landing/src/lib/lead-security.ts", [
  "TRUSTED_PROXY_IP_HEADER",
  "leadFingerprint",
  "isIP",
]);

const controlMigration = read(
  "database/control-plane/migrations/009_crm_release_scope.sql",
);
if (!controlMigration.includes("modules = '[\"crm\"]'::jsonb")) {
  failures.push("Billing plans are not constrained to the released CRM module.");
}
if (!controlMigration.includes("modules_snapshot = '[\"crm\"]'::jsonb")) {
  failures.push("Subscription module snapshots are not constrained to CRM.");
}

requireMarkers("apps/web/scripts/verify-crm-database.mjs", [
  "requiredTables",
  "relforcerowsecurity",
  "pg_policy",
  "app.current_organization_id",
  '"crm_lead"',
  '"crm_opportunity"',
  '"crm_campaign"',
  '"crm_activity"',
]);


requireMarkers("apps/web/src/lib/security.ts", [
  "client?: PoolClient",
  "input.client.query(statement, values)",
]);
for (const file of [
  "apps/web/src/app/api/crm/[resource]/route.ts",
  "apps/web/src/app/api/crm/[resource]/[id]/route.ts",
  "apps/web/src/app/api/crm/[resource]/import/route.ts",
  "apps/web/src/app/api/crm/activities/[id]/complete/route.ts",
  "apps/web/src/app/api/crm/leads/[id]/convert/route.ts",
  "apps/web/src/app/api/crm/leads/[id]/merge/route.ts",
  "apps/web/src/app/api/crm/opportunities/[id]/stage/route.ts",
]) {
  requireMarkers(file, ["tenantTransaction", "client,"]);
}
requireMarkers("apps/web/src/app/api/onboarding/route.ts", [
  "UPDATE sessions",
  "active_organization_id",
  "client,",
]);

requireMarkers("apps/landing/src/components/home/hero-section.tsx", [
  "Released CRM early access",
  "Roadmap modules",
  'value: "11"',
]);
const publicHero = read("apps/landing/src/components/home/hero-section.tsx");
if (publicHero.includes("Run every core operation") || publicHero.includes('value: "12"')) {
  failures.push("The public hero still presents roadmap modules as released capability.");
}

requireMarkers("package.json", [
  '"db:provision:runtime-role": "corepack pnpm --filter @vercent/web',
]);
requireMarkers("apps/web/scripts/provision-runtime-role.mjs", [
  'import dotenv from "dotenv"',
  'import pg from "pg"',
  'path.resolve(process.cwd(), ".env.local")',
  "NOSUPERUSER",
  "NOBYPASSRLS",
]);

requireMarkers("apps/web/next.config.mjs", ['output: "standalone"']);
requireMarkers("infrastructure/docker/compose.production.example.yml", [
  "Dockerfile.worker",
  "CRM_JOBS_INTERVAL_SECONDS",
  "CRM_OUTBOX_INTERVAL_SECONDS",
  "no-new-privileges:true",
]);

const shell = read("apps/web/src/components/app-shell.tsx");
if (shell.includes('href: "/approvals"')) {
  failures.push("The unreleased approvals page remains in primary navigation.");
}

const roadmapModuleKeys = [
  "accounting",
  "procurement",
  "sales",
  "stock",
  "manufacturing",
  "projects",
  "assets",
  "point-of-sale",
  "quality",
  "support",
  "hr-payroll",
];
for (const key of roadmapModuleKeys) {
  if (!controlMigration.includes(`('${key}',`)) {
    failures.push(`Roadmap module scope is missing ${key}.`);
  }
}

const forbiddenAutomationPatterns = [
  /demo\.vercent\.example\.test/i,
  /seed[-_: ]demo/i,
  /reset[-_: ]demo/i,
  /create[-_: ]demo[-_: ](?:user|company|tenant)/i,
];
const automationFiles = [
  ...fs.readdirSync(path.join(root, "scripts"), { recursive: true }),
].filter((entry) => typeof entry === "string" && /\.(?:mjs|js|sh)$/.test(entry));
for (const relative of automationFiles) {
  const file = path.join("scripts", relative);
  const source = read(file);
  for (const pattern of forbiddenAutomationPatterns) {
    if (pattern.test(source)) failures.push(`Automatic demo-data behavior found in ${file}.`);
  }
}

requireMarkers("apps/web/.env.example", ["ENFORCE_RESTRICTED_DB_ROLE=true"]);

if (failures.length) {
  console.error("CRM release verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `CRM release scope verified: 1 released module, ${roadmapModuleKeys.length} roadmap modules, mandatory CRM foundations and production controls.`,
);
