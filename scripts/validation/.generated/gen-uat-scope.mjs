import fs from "node:fs";

function parseCsv(text) {
  const rows = []; let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) { if (ch === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQuotes = false; } else field += ch; }
    else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch === "\r") {}
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => !(r.length===1 && r[0]===""));
}

function mdEscape(s) {
  return String(s || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

const text = fs.readFileSync("docs/implementation/ERP_EXACT_FEATURE_MATRIX_015.csv", "utf8");
const table = parseCsv(text);
const header = table[0];
const rows = table.slice(1).map(r => Object.fromEntries(header.map((h,i)=>[h, r[i] ?? ""])));

const testable = rows.filter(r => r.uat_status === "READY" || r.uat_status === "LIMITED");

const MODULE_ROLE = {
  CRM: "CRM user (crm.leads.manage / crm.opportunities.manage as relevant; crm.records.view_all for team-wide rows)",
  Sales: "Sales user (sales.* permissions as relevant)",
  Procurement: "Procurement user (procurement.* permissions as relevant)",
  "Stock and Warehouse Management": "Stock user (stock.* permissions as relevant)",
  "HR & Payroll": "HR user (hr_payroll.* permissions as relevant)",
  "Support and Customer Service": "Support user (support.* permissions as relevant)",
  "Quality Management": "Quality user (quality.* permissions as relevant)",
  "Point of Sale": "POS user (pos.* permissions as relevant)",
  Assets: "Assets user (assets.* permissions as relevant)",
  Projects: "Projects user (projects.* permissions as relevant)",
  Manufacturing: "Manufacturing user (manufacturing.* permissions as relevant)",
  Shared: "Any authenticated workspace user (or Administration/Governance role for admin-surface rows)",
};

function setupFor(r) {
  const moduleLabel = r.scope === "shared" ? "the relevant Administration/Governance/shared workspace area" : `the ${r.module} module`;
  return `Sign in with a role granting ${r.permission_evidence || "the feature's governing permission"}; navigate to ${moduleLabel}.`;
}

function stepsFor(r) {
  const path = r.ui_evidence || r.service_evidence || "the documented API route";
  return `Exercise "${r.feature_name}" via ${path}.`;
}

function outcomeFor(r) {
  const proof = r.test_evidence ? `; automated coverage: ${r.test_evidence}` : "";
  return `Behaves as described by the exact requirement wording${proof}.`;
}

function limitationFor(r) {
  if (r.uat_status === "READY") return "";
  return r.primary_gap || r.notes || "See primary_gap in the matrix.";
}

const byModule = {};
for (const r of testable) {
  const key = r.scope === "shared" ? "Shared" : r.module;
  (byModule[key] ||= []).push(r);
}

const moduleOrder = ["CRM","Sales","Procurement","Stock and Warehouse Management","HR & Payroll","Support and Customer Service","Quality Management","Point of Sale","Assets","Projects","Manufacturing","Shared"];

let out = "";
for (const m of moduleOrder) {
  const items = byModule[m];
  if (!items || !items.length) continue;
  const ready = items.filter(r=>r.uat_status==="READY").length;
  const limited = items.filter(r=>r.uat_status==="LIMITED").length;
  out += `\n## ${m} (${items.length} testable: ${ready} READY, ${limited} LIMITED)\n\n`;
  out += `| ID | Feature | Role | Setup | Test steps | Expected outcome | Status | Known limitation |\n`;
  out += `|---|---|---|---|---|---|---|---|\n`;
  for (const r of items) {
    out += `| ${r.feature_id} | ${mdEscape(r.feature_name)} | ${mdEscape(MODULE_ROLE[m])} | ${mdEscape(setupFor(r))} | ${mdEscape(stepsFor(r))} | ${mdEscape(outcomeFor(r))} | ${r.uat_status} | ${mdEscape(limitationFor(r))} |\n`;
  }
}

fs.writeFileSync("scripts/validation/.generated/uat-scope-body.md", out);
console.log("Wrote uat-scope-body.md —", testable.length, "testable rows across", Object.keys(byModule).length, "groups.");
