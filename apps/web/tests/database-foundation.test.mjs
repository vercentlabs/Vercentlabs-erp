import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const migration = fs.readFileSync(
  path.resolve(
    root,
    "../../database/control-plane/migrations/002_platform_foundation.sql",
  ),
  "utf8",
);

const requiredTables = [
  "password_history",
  "login_events",
  "departments",
  "cost_centers",
  "teams",
  "permissions",
  "roles",
  "role_permissions",
  "user_role_assignments",
  "membership_company_access",
  "membership_branch_access",
  "membership_department_access",
  "user_preferences",
  "notifications",
  "numbering_series",
  "organization_modules",
  "workflow_definitions",
  "approval_requests",
  "activities",
  "comments",
  "attachments",
  "custom_field_definitions",
  "custom_field_values",
];

test("platform migration includes every required shared foundation table", () => {
  for (const table of requiredTables) {
    assert.match(
      migration,
      new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`),
      `Missing table ${table}`,
    );
  }
});

test("platform migration registers all twelve ERP modules", () => {
  for (const moduleKey of [
    "accounting",
    "procurement",
    "sales",
    "crm",
    "stock",
    "manufacturing",
    "projects",
    "assets",
    "point-of-sale",
    "quality",
    "support",
    "hr-payroll",
  ]) {
    assert.match(migration, new RegExp(`'${moduleKey}'`));
  }
});

test("audit records are made immutable", () => {
  assert.match(migration, /prevent_audit_event_mutation/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON audit_events/);
});
