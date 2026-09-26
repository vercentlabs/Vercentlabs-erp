#!/usr/bin/env node
// Verifies the field-level security registry (packages/permissions/src/
// field-security.js) against the code and writes
// docs/frontend-rebuild/FIELD_SECURITY_MATRIX.csv:
//   - every business module is audited (a rule or a documented "no rule");
//   - every permission named exists in the permission catalogue;
//   - every enforcement point exists and names the fields it protects;
//   - shared output channels marked "excluded" (report datasets, search,
//     event projections, PDF documents) never reference a protected field;
//   - the CRM lead export is built from the projected module read.
// The behavioural half (a caller without the permission really gets no
// values through list, export and report) is
// tests/integration/production/field-security-db.test.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as permissions from "../../packages/permissions/src/index.js";
import { FIELD_SECURITY, FIELD_SECURITY_CHANNELS, FIELD_SECURITY_NOT_APPLICABLE } from "../../packages/permissions/src/field-security.js";
import { ERP_MODULE_CATALOG } from "../../packages/shared-types/src/modules.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

export function verifyFieldSecurity() {
  const problems = [];
  const known = new Set(permissions.ALL_PERMISSIONS);
  for (const value of Object.values(permissions)) {
    if (value && typeof value === "object" && !Array.isArray(value)) for (const entry of Object.values(value)) if (typeof entry === "string" && entry.includes(".")) known.add(entry);
  }

  const moduleKeys = ERP_MODULE_CATALOG.map((module) => module.key ?? module.id ?? module.moduleId);
  if (moduleKeys.length !== ERP_MODULE_CATALOG.length || moduleKeys.some((key) => !key)) problems.push("could not read module keys from ERP_MODULE_CATALOG");
  for (const key of moduleKeys) {
    if (!FIELD_SECURITY.some((entry) => entry.module === key) && !FIELD_SECURITY_NOT_APPLICABLE[key]) problems.push(`module ${key} has no field-security audit entry`);
  }

  for (const entry of FIELD_SECURITY) {
    const label = `${entry.module}/${entry.resource}`;
    for (const permission of [entry.readPermission, entry.writePermission].filter(Boolean)) {
      if (!known.has(permission)) problems.push(`${label}: permission ${permission} is not in the permission catalogue`);
    }
    for (const channel of FIELD_SECURITY_CHANNELS) if (!entry.channels[channel]) problems.push(`${label}: channel ${channel} not declared`);
    for (const [side, reference] of Object.entries(entry.enforcement)) {
      // "file#symbol[;file#symbol…]" = code references; anything else is a
      // described rule (e.g. a computed value).
      const references = reference.split(";").filter((part) => /^[w./-]+.(m?js|ts)#S+$/.test(part));
      if (!references.length) continue;
      let combined = "";
      for (const part of references) {
        const [file, symbol] = part.split("#");
        if (!fs.existsSync(path.join(root, file))) {
          problems.push(`${label}: ${side} enforcement file ${file} is missing`);
          continue;
        }
        const source = read(file);
        combined += source;
        if (!source.includes(symbol)) problems.push(`${label}: ${side} enforcement ${symbol} not found in ${file}`);
      }
      if (side === "read" && entry.fields[0] !== "*") {
        const missing = entry.fields.filter((field) => !combined.includes(field));
        if (missing.length) problems.push(`${label}: read enforcement does not name protected field(s) ${missing.join(", ")}`);
      }
    }
  }

  // Shared channels that must never carry protected fields.
  const distinctive = (entry) => entry.fields.filter((field) => field !== "*" && field.length >= 5 && !["rate", "cost"].includes(field));
  const excludedChannelSources = {
    report: "services/api/src/orchestration/reporting/datasets.js",
    search: "services/api/src/orchestration/search/providers.js",
    events: "services/api/src/core/platform/events/registry.js",
    document: "services/api/src/orchestration/documents/registry.js",
  };
  for (const [channel, file] of Object.entries(excludedChannelSources)) {
    const code = stripComments(read(file));
    for (const entry of FIELD_SECURITY) {
      if (entry.channels[channel] !== "excluded") continue;
      for (const field of distinctive(entry)) {
        if (new RegExp(`["'\`.]${field}["'\`,\\s)]`).test(code)) problems.push(`${channel} channel (${file}) references protected ${entry.module}/${entry.resource} field ${field}`);
      }
    }
  }

  const leadExport = read("services/api/src/modules/crm/prospect-and-relationship-master-data/lead-export.js");
  if (!/listCrmRecords\(client, context, "leads"/.test(leadExport)) problems.push("CRM lead export is not built from the projected listCrmRecords read");
  if (!/assertCrmExportAllowed\(context\)[\s\S]*buildCrmLeadExportCsv|export async function buildCrmLeadExportCsv[\s\S]*?assertCrmExportAllowed\(context\)/.test(leadExport)) problems.push("CRM lead export does not re-check crm.export when building");
  return problems;
}

export function fieldSecurityCsv() {
  const header = ["module", "resource", "fields", "read_permission", "write_permission", "owner_bypass", "read_enforcement", "write_enforcement", ...FIELD_SECURITY_CHANNELS, "note"];
  const field = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const lines = [header.join(",")];
  for (const entry of FIELD_SECURITY) {
    lines.push([entry.module, entry.resource, entry.fields.join(" "), entry.readPermission, entry.writePermission ?? "(not writable)", entry.ownerBypass, entry.enforcement.read, entry.enforcement.write, ...FIELD_SECURITY_CHANNELS.map((channel) => entry.channels[channel]), entry.note ?? ""].map(field).join(","));
  }
  for (const [module, reason] of Object.entries(FIELD_SECURITY_NOT_APPLICABLE)) lines.push([module, "(none)", "", "", "", "", "", "", ...FIELD_SECURITY_CHANNELS.map(() => ""), reason].map(field).join(","));
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = verifyFieldSecurity();
  fs.writeFileSync(path.join(root, "docs/frontend-rebuild/FIELD_SECURITY_MATRIX.csv"), fieldSecurityCsv());
  if (problems.length) {
    console.error(`FIELD SECURITY VERIFICATION FAILED:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`Field security verified: ${FIELD_SECURITY.length} rules, ${Object.keys(FIELD_SECURITY_NOT_APPLICABLE).length} modules without field rules; matrix written.`);
}
