import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ROLE_TEMPLATE_BY_SLUG, COMPANY_ADMINISTRATOR_CRM_PERMISSIONS } from "../src/index.js";
import { buildMigration, MIGRATION_PATH } from "../../../scripts/database/generate-crm-canonical-role-migration.mjs";

// CRM role hierarchy: the built-in role templates are the single source of
// truth, and platform migration 058 reconciles existing tenants to them.

const crm = (slug) => new Set(ROLE_TEMPLATE_BY_SLUG.get(slug).permissions.filter((key) => key.startsWith("crm.")));

test("migration 058 is exactly what the generator produces from the current templates (no drift)", () => {
  assert.equal(readFileSync(MIGRATION_PATH, "utf8").replace(/\r\n/g, "\n"), buildMigration(),
    "roles.js changed: run node scripts/database/generate-crm-canonical-role-migration.mjs and add a new migration");
});

test("migration 058 only touches crm.* keys on built-in roles and is idempotent in shape", () => {
  const sql = buildMigration();
  assert.match(sql, /role\.is_system = true[\s\S]*permission_key LIKE 'crm\.%'/);
  assert.match(sql, /ON CONFLICT DO NOTHING/);
  assert.match(sql, /JOIN permissions permission ON permission\.key = canonical\.permission_key/, "never grants a key missing from the catalog");
  assert.doesNotMatch(sql, /UPDATE roles|DELETE FROM roles|is_system = false/, "custom roles and role rows are never modified");
});

test("Sales Manager is team-scoped, Sales Head sees all CRM records", () => {
  assert.ok(!crm("sales_manager").has("crm.records.view_all"));
  assert.ok(crm("sales_head").has("crm.records.view_all"));
  assert.ok(!crm("sales_representative").has("crm.records.view_all"));
});

test("Company Administrator keeps only CRM module access and reports", () => {
  assert.deepEqual([...crm("company_administrator")].sort(), [...COMPANY_ADMINISTRATOR_CRM_PERMISSIONS].sort());
  assert.ok(ROLE_TEMPLATE_BY_SLUG.get("company_administrator").permissions.some((key) => key.startsWith("users.") || key.startsWith("organization.") || key.startsWith("companies.")),
    "non-CRM administration is unaffected");
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
