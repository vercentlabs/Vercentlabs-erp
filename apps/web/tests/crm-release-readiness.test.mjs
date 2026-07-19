import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("readiness verifies the latest migration names using the migration ledger schema", () => {
  const source = read("src/app/api/readiness/route.ts");
  assert.match(source, /009_crm_release_scope\.sql/);
  assert.match(source, /006_crm_release_foundation\.sql/);
  assert.match(source, /WHERE name = \$1/);
  assert.doesNotMatch(source, /WHERE filename/);
});

test("new organizations receive complete CRM configuration and numbering", () => {
  const platform = read("src/lib/platform.ts");
  for (const marker of [
    "seedCrmFoundation",
    "crm_pipelines",
    "crm_pipeline_stages",
    "crm_settings",
    "crm_lead_sources",
    "crm_lost_reasons",
    "crm_tags",
    "crm_sales_teams",
    '"crm_lead"',
    '"crm_opportunity"',
    '"crm_campaign"',
  ]) assert.match(platform, new RegExp(marker));
});

test("the release scope exposes CRM and blocks roadmap modules", () => {
  const platform = read("src/lib/platform.ts");
  const route = read("src/app/api/modules/[key]/route.ts");
  const migration = read(
    "../../database/control-plane/migrations/009_crm_release_scope.sql",
  );
  assert.match(platform, /key: "crm"[\s\S]*availability: "released"/);
  assert.match(platform, /availability: "roadmap"/);
  assert.match(route, /cannot be activated in this release/);
  assert.match(route, /CRM is the released product and cannot be disabled/);
  assert.match(migration, /modules = '\["crm"\]'::jsonb/);
});

test("CRM imports recover each invalid database row with savepoints", () => {
  const source = read("src/app/api/crm/[resource]/import/route.ts");
  assert.match(source, /SAVEPOINT/);
  assert.match(source, /ROLLBACK TO SAVEPOINT/);
  assert.match(source, /RELEASE SAVEPOINT/);
});

test("direct CRM pages require crm.view", () => {
  for (const file of [
    "src/app/(app)/crm/leads/[id]/page.tsx",
    "src/app/(app)/crm/opportunities/[id]/page.tsx",
    "src/app/(app)/crm/pipeline/page.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /PERMISSIONS\.crmView/);
    assert.match(source, /notFound/);
  }
});

test("global search checks permissions and uses scoped services", () => {
  const source = read("src/app/(app)/search/page.tsx");
  assert.match(source, /PERMISSIONS\.crmView/);
  assert.match(source, /PERMISSIONS\.businessDataView/);
  assert.match(source, /listCrmRecords/);
  assert.match(source, /listBusinessDataRecords/);
  assert.match(source, /tenantTransaction/);
});

test("production web output is standalone", () => {
  assert.match(read("next.config.mjs"), /output: "standalone"/);
});

test("CRM mutations and onboarding commit their audit evidence atomically", () => {
  const security = read("src/lib/security.ts");
  assert.match(security, /client\?: PoolClient/);
  assert.match(security, /input\.client\.query\(statement, values\)/);

  for (const file of [
    "src/app/api/crm/[resource]/route.ts",
    "src/app/api/crm/[resource]/[id]/route.ts",
    "src/app/api/crm/[resource]/import/route.ts",
    "src/app/api/crm/activities/[id]/complete/route.ts",
    "src/app/api/crm/leads/[id]/convert/route.ts",
    "src/app/api/crm/leads/[id]/merge/route.ts",
    "src/app/api/crm/opportunities/[id]/stage/route.ts",
  ]) {
    const source = read(file);
    assert.match(source, /tenantTransaction/);
    assert.match(source, /audit\(\{[\s\S]*client,/);
  }

  const onboarding = read("src/app/api/onboarding/route.ts");
  assert.match(onboarding, /UPDATE sessions[\s\S]*active_organization_id/);
  assert.match(onboarding, /audit\(\{[\s\S]*client,/);
  assert.doesNotMatch(onboarding, /setSessionOrganization/);
});

test("runtime-role provisioning executes where pg and dotenv are declared", () => {
  const rootPackage = JSON.parse(read("../../package.json"));
  const webPackage = JSON.parse(read("package.json"));
  assert.match(
    rootPackage.scripts["db:provision:runtime-role"],
    /--filter @vercent\/web/,
  );
  assert.ok(webPackage.dependencies.pg);
  assert.ok(webPackage.dependencies.dotenv);
  assert.match(read("scripts/provision-runtime-role.mjs"), /import pg from "pg"/);
});
