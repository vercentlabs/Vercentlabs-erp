#!/usr/bin/env node
// Authorization matrix (verification artifact, not runtime configuration):
// every route handler with its protection class, module, permission, record
// scope, field scope, billing write gate and denial audit, derived from the
// route security matrix (generate-route-security-matrix.mjs) and the field
// security registry (packages/permissions/src/field-security.js). Permissions
// come from the code; this file introduces none.
//
//   node scripts/qa/generate-authorization-matrix.mjs   -> docs/frontend-rebuild/AUTHORIZATION_MATRIX.csv
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FIELD_SECURITY } from "../../packages/permissions/src/field-security.js";
import { buildMatrix } from "./generate-route-security-matrix.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Record scope as each module's domain enforces it (on top of PostgreSQL RLS
// on the organisation, which applies to every workspace handler).
export const RECORD_SCOPE = Object.freeze({
  crm: "company/branch scope + record ownership unless crm.records.view_all (crm-data-operations-and-customization/record-policy.js)",
  sales: "active company/branch; approvals and self-approval rules in the domain",
  accounting: "active company; segregation of duties (no self-approval) in the domain",
  procurement: "active company; self-approval blocked",
  stock: "active company and warehouse",
  manufacturing: "active company",
  projects: "active company; project manager/team membership unless a broad projects permission",
  assets: "active company; custodian rules in the domain",
  "point-of-sale": "active company, store and terminal/shift ownership",
  quality: "active company",
  support: "active company; own tickets for portal self-service",
  "hr-payroll": "active company; own employee record for self-service; manager chain for approvals",
});

const PLATFORM_SCOPE = "organisation (RLS) + the route permission; domain scoping per the protection note";

export function buildAuthorizationMatrix() {
  const fieldRules = new Map();
  for (const entry of FIELD_SECURITY) {
    const list = fieldRules.get(entry.module) ?? [];
    list.push(`${entry.resource}: ${entry.readPermission}`);
    fieldRules.set(entry.module, list);
  }
  const problems = [];
  const rows = buildMatrix().map((row) => {
    const source = fs.readFileSync(path.join(root, "apps/web/src/app", row.route), "utf8");
    const module = row.module || "";
    let recordScope = "";
    if (row.class === "WORKSPACE_MODULE") {
      recordScope = RECORD_SCOPE[module] ?? (/^[a-z]+.[a-zA-Z]+$/.test(module) ? "the owning module of the rendered document (renderer.moduleKey/permission), re-checked by its read" : "");
      if (!recordScope) problems.push(`${row.route} ${row.method}: module ${module} has no record-scope entry`);
    } else if (row.class === "WORKSPACE_PLATFORM") recordScope = PLATFORM_SCOPE;
    else recordScope = row.protection;
    return {
      route: row.route,
      method: row.method,
      class: row.class,
      module,
      permission: row.permission || (row.class.startsWith("WORKSPACE") ? "" : "n/a"),
      recordScope,
      fieldScope: (fieldRules.get(module) ?? []).join("; "),
      billingWrite: row.billingWrite ? "yes" : "no",
      audit: /auditDenial:\s*true/.test(source) ? "denials audited" : row.class.startsWith("WORKSPACE") ? "denials logged" : "n/a",
    };
  });
  return { rows, problems };
}

function csv(rows) {
  const header = ["route", "method", "class", "module", "permission", "record_scope", "field_scope", "billing_write", "audit"];
  const cell = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `${[header.join(","), ...rows.map((row) => [row.route, row.method, row.class, row.module, row.permission, row.recordScope, row.fieldScope, row.billingWrite, row.audit].map(cell).join(","))].join("\n")}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { rows, problems } = buildAuthorizationMatrix();
  fs.writeFileSync(path.join(root, "docs/frontend-rebuild/AUTHORIZATION_MATRIX.csv"), csv(rows));
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`Authorization matrix: ${rows.length} handlers -> docs/frontend-rebuild/AUTHORIZATION_MATRIX.csv`);
}
