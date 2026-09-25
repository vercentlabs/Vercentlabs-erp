import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ROLE_TEMPLATE_BY_SLUG } from "../src/index.js";
import { buildMigration, listSyncMigrations, MIGRATIONS_DIR } from "../../../scripts/database/generate-canonical-role-sync-migration.mjs";

// CRM role hierarchy: the built-in role templates are the single source of
// truth. Migration 058 (historical, CRM-only) and the general canonical role
// sync migrations (scripts/database/generate-canonical-role-sync-migration.mjs)
// reconcile existing tenants to them.

const crm = (slug) => new Set(ROLE_TEMPLATE_BY_SLUG.get(slug).permissions.filter((key) => key.startsWith("crm.")));

test("the latest canonical role sync migration is exactly what the generator produces (no drift)", () => {
  const latest = listSyncMigrations().at(-1);
  assert.ok(latest, "a canonical role sync migration must exist");
  assert.equal(readFileSync(path.join(MIGRATIONS_DIR, latest), "utf8").replace(/\r\n/g, "\n"), buildMigration(),
    "roles.js changed: run node scripts/database/generate-canonical-role-sync-migration.mjs --write and re-lock");
});

test("the sync migration only reconciles built-in roles and never rewrites assignments or evidence", () => {
  const sql = buildMigration().split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
  assert.match(sql, /WHERE role\.is_system = true/);
  assert.match(sql, /ON CONFLICT \(organization_id, slug\) DO NOTHING/,"a custom role owning a built-in slug is left alone");
  assert.doesNotMatch(sql, /user_role_assignments/, "assignments are never touched");
  assert.doesNotMatch(sql, /(UPDATE|DELETE FROM) role_version_snapshots/, "historical role versions are immutable");
  assert.doesNotMatch(sql, /DELETE FROM roles|is_system = false/, "role rows are never deleted and custom roles are never modified");
  assert.match(sql, /RAISE EXCEPTION 'canonical role sync: permission key missing/, "never silently grants less than the template");
});

test("Sales Manager is team-scoped, Sales Head sees all CRM records", () => {
  assert.ok(!crm("sales_manager").has("crm.records.view_all"));
  assert.ok(crm("sales_head").has("crm.records.view_all"));
  assert.ok(!crm("sales_representative").has("crm.records.view_all"));
});

test("Company Administrator carries no CRM permission at all (compose CRM Administrator instead)", () => {
  assert.deepEqual([...crm("company_administrator")], []);
  assert.ok(ROLE_TEMPLATE_BY_SLUG.get("company_administrator").permissions.includes("users.manage"), "user administration is kept");
});

test("sensitive contact/account access is consistent across the sales roles", () => {
  for (const slug of ["crm_administrator", "sales_head", "sales_manager", "sales_representative", "sales_operations"])
    for (const key of ["crm.leads.view_sensitive", "crm.contacts.view_sensitive", "crm.accounts.view_sensitive"])
      assert.ok(crm(slug).has(key), `${slug} lacks ${key}`);
  for (const slug of ["auditor", "read_only", "support_manager", "company_administrator"])
    for (const key of ["crm.leads.view_sensitive", "crm.contacts.view_sensitive", "crm.accounts.view_sensitive"])
      assert.ok(!crm(slug).has(key), `${slug} must not have ${key}`);
});

test("Organisation Owner and System Administrator hold every CRM permission", () => {
  const all = new Set([...ROLE_TEMPLATE_BY_SLUG.values()].flatMap((role) => role.permissions.filter((key) => key.startsWith("crm."))));
  for (const slug of ["organization_owner", "system_administrator"])
    for (const key of all) assert.ok(crm(slug).has(key), `${slug} lacks ${key}`);
});

test("resource-specific visibility replaces the umbrella where a role needs one kind of record", () => {
  const has = (slug, key) => crm(slug).has(key);
  assert.ok(has("marketing_manager", "crm.leads.view_all") && !has("marketing_manager", "crm.records.view_all"), "Marketing: every Lead, not every CRM record");
  assert.ok(has("customer_success_manager", "crm.customers.view_all") && !has("customer_success_manager", "crm.records.view_all"), "CS: customer Accounts, not every CRM record");
  assert.ok(!has("partner_manager", "crm.records.view_all") && has("partner_manager", "crm.partners.manage"), "Partner: partner relationships, not every CRM record");
  assert.ok(!has("sales_representative", "crm.leads.view_all") && !has("sales_manager", "crm.leads.view_all"));
});

test("Auditor and Read-only read company-wide but can change nothing in CRM", () => {
  for (const slug of ["auditor", "read_only"]) {
    assert.ok(crm(slug).has("crm.records.view_all"), `${slug} reads company-wide`);
    const writes = [...crm(slug)].filter((key) => key.endsWith(".manage") || key === "crm.import");
    assert.deepEqual(writes, [], `${slug} has no CRM mutation, import or settings permission`);
    for (const key of ["crm.leads.view_sensitive", "crm.contacts.view_sensitive", "crm.accounts.view_sensitive"]) assert.ok(!crm(slug).has(key));
  }
  assert.ok(crm("auditor").has("crm.export") && !crm("read_only").has("crm.export"), "only the Auditor exports (its read scope)");
});
