import fs from "node:fs";

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ""; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch === '\r') {}
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => !(r.length===1 && r[0]===""));
}

const text = fs.readFileSync("docs/implementation/ERP_EXACT_FEATURE_MATRIX_015.csv", "utf8");
const table = parseCsv(text);
const header = table[0];
const rows = table.slice(1).map(r => Object.fromEntries(header.map((h,i)=>[h, r[i] ?? ""])));

function count(rows, key) {
  const c = {};
  for (const r of rows) c[r[key]] = (c[r[key]]||0)+1;
  return c;
}

console.log("=== OVERALL STATUS ===", count(rows, "status"));
console.log("=== OVERALL UAT ===", count(rows, "uat_status"));
console.log("=== OVERALL PRIORITY ===", count(rows, "priority"));
console.log("=== BLOCKER TYPE ===", count(rows, "blocker_type"));

const modules = [...new Set(rows.filter(r=>r.scope==="module").map(r=>r.module))];
console.log("\n=== PER MODULE ===");
for (const m of modules) {
  const mr = rows.filter(r=>r.module===m);
  console.log(m, count(mr, "status"), "UAT:", count(mr, "uat_status"));
}

console.log("\n=== SHARED BY CATEGORY ===");
const sharedCats = [...new Set(rows.filter(r=>r.scope==="shared").map(r=>r.category))];
for (const c of sharedCats) {
  const cr = rows.filter(r=>r.scope==="shared" && r.category===c);
  console.log(c, count(cr, "status"));
}

console.log("\n=== P0 ROWS ===");
const p0 = rows.filter(r=>r.priority==="P0");
console.log("count:", p0.length);
for (const r of p0) console.log(` ${r.feature_id} [${r.status}] ${r.feature_name} -- ${r.primary_gap}`);

console.log("\n=== COMPLETE count sanity per module (against baseline) ===");
const BASELINE = {CRM:74,Sales:76,Procurement:79,"Stock and Warehouse Management":90,"HR & Payroll":108,"Support and Customer Service":75,"Quality Management":77,"Point of Sale":89,Assets:73,Projects:86,Manufacturing:118};
for (const [m,total] of Object.entries(BASELINE)) {
  const mr = rows.filter(r=>r.module===m);
  const complete = mr.filter(r=>r.status==="COMPLETE").length;
  console.log(m, `${complete}/${total} (${(100*complete/total).toFixed(1)}%)`, "actual rows:", mr.length);
}
