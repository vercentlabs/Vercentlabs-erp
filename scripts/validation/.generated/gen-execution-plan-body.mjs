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

const text = fs.readFileSync("docs/implementation/ERP_EXACT_FEATURE_MATRIX_015.csv", "utf8");
const table = parseCsv(text);
const header = table[0];
const rows = table.slice(1).map(r => Object.fromEntries(header.map((h,i)=>[h, r[i] ?? ""])));
const byId = new Map(rows.map(r => [r.feature_id, r]));

const assignments = JSON.parse(fs.readFileSync("scripts/validation/.generated/prompt-assignments.json", "utf8"));
const accNames = {
  "ACC-034": "TDS (withholding tax)", "ACC-035": "Depreciation calculation engine",
  "ACC-036": "Sales to Accounting integration", "ACC-037": "Procurement to Accounting integration",
  "ACC-038": "E-invoice (GST)", "ACC-039": "E-way bill", "ACC-040": "TCS (tax collected at source)",
  "ACC-041": "POS to Accounting integration", "ACC-042": "HR & Payroll to Accounting integration",
  "ACC-043": "Assets (equipment module) to Accounting integration",
};

const byPrompt = {};
for (const [id, prompt] of Object.entries(assignments)) {
  const row = byId.get(id);
  if (row && row.status === "COMPLETE") continue;
  const rec = row
    ? { id, name: row.feature_name, category: row.category, status: row.status, module: row.scope === "shared" ? "Shared" : row.module }
    : { id, name: accNames[id], category: "Accounting", status: "n/a", module: "Accounting" };
  (byPrompt[Number(prompt)] ||= []).push(rec);
}

// Module-campaign range -> title prefix
const MODULE_TITLE = {
  "CRM": "CRM", "Sales": "Sales", "Procurement": "Procurement",
  "Stock and Warehouse Management": "Stock", "Manufacturing": "Manufacturing",
  "Projects": "Projects", "Assets": "Assets", "Point of Sale": "POS",
  "Quality Management": "Quality", "Support and Customer Service": "Support",
  "HR & Payroll": "HR & Payroll", "Shared": "Shared platform", "Accounting": "Accounting",
};

const promptNums = Object.keys(byPrompt).map(Number).sort((a,b)=>a-b).filter(n => n >= 24 && n <= 86);

let out = "";
for (const p of promptNums) {
  const items = byPrompt[p];
  const cats = [...new Set(items.map(i => i.category))];
  const moduleName = MODULE_TITLE[items[0].module] || items[0].module;
  const title = cats.length <= 2 ? cats.join(" + ") : `${cats[0]} + ${cats.length - 1} more`;
  const ids = items.map(i => i.id).join(", ");
  const statusCounts = {};
  for (const i of items) statusCounts[i.status] = (statusCounts[i.status]||0)+1;
  const statusSummary = Object.entries(statusCounts).map(([s,n])=>`${n} ${s}`).join(", ");
  out += `### Prompt ${p}\n`;
  out += `**Title**: ${moduleName} — ${title}\n\n`;
  out += `**Targets** (${items.length} features: ${statusSummary}): ${ids}\n\n`;
  out += `**Categories covered**: ${cats.join("; ")}\n\n`;
  out += `---\n\n`;
}

fs.writeFileSync("scripts/validation/.generated/execution-plan-module-campaigns.md", out);
console.log("wrote execution-plan-module-campaigns.md,", promptNums.length, "prompts");
