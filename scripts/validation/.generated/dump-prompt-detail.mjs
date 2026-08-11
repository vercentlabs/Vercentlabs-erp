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
const accRows = {
  "ACC-034": "TDS (withholding tax)", "ACC-035": "Depreciation calculation engine",
  "ACC-036": "Sales to Accounting integration", "ACC-037": "Procurement to Accounting integration",
  "ACC-038": "E-invoice (GST)", "ACC-039": "E-way bill", "ACC-040": "TCS (tax collected at source)",
  "ACC-041": "POS to Accounting integration", "ACC-042": "HR & Payroll to Accounting integration",
  "ACC-043": "Assets (equipment module) to Accounting integration",
};

const byPrompt = {};
for (const [id, prompt] of Object.entries(assignments)) {
  const row = byId.get(id);
  if (row && row.status === "COMPLETE") continue; // skip the one accidental COMPLETE claim
  const name = row ? row.feature_name : accRows[id];
  const category = row ? row.category : "Accounting";
  (byPrompt[prompt] ||= []).push({ id, name, category, status: row ? row.status : "n/a" });
}

const promptNums = Object.keys(byPrompt).map(Number).sort((a,b)=>a-b);
for (const p of promptNums) {
  console.log(`\n### PROMPT ${p} (${byPrompt[p].length} features)`);
  for (const item of byPrompt[p]) {
    console.log(`  ${item.id} [${item.status}] ${item.name}`);
  }
}
