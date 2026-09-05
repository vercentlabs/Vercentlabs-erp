// Local one-off helper (not committed as a "process script" — just a way to
// extract a feature's full requirement/flow/semantic/state-transition rows
// for manual audit). Usage: node dump_feature_requirements.mjs F001
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const featureId = process.argv[2];
if (!featureId) {
  console.error("Usage: node dump_feature_requirements.mjs F001");
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else {
      if (c === '"') quoted = true;
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        field = "";
      } else field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function load(file) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  const rows = parseCsv(text);
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return { header, idx, rows: rows.slice(1) };
}

const registers = [
  ["SUBREQUIREMENT", "docs/02-register/SUBREQUIREMENT_REGISTER.csv"],
  ["FLOW", "docs/02-register/FEATURE_FLOW_REGISTER.csv"],
  ["SEMANTIC", "docs/02-register/FEATURE_SEMANTIC_SUBCAPABILITY_REGISTER.csv"],
  ["STATE_TRANSITION", "docs/02-register/FEATURE_STATE_TRANSITION_REGISTER.csv"],
];

for (const [label, file] of registers) {
  const { idx, rows } = load(file);
  const matched = rows.filter((r) => r[idx.feature_id] === featureId);
  console.log(`\n=== ${label} (${matched.length} rows) ===`);
  for (const r of matched) {
    const id = r[idx.requirement_id] ?? r[idx.flow_id] ?? r[idx.semantic_id] ?? r[idx.transition_id] ?? "?";
    const title = r[idx.title] ?? r[idx.normative_scope] ?? "";
    const stmt =
      r[idx.normative_statement] ??
      r[idx.acceptance_condition] ??
      r[idx.steps] ??
      "";
    console.log(`- ${id}${title ? " — " + title : ""}`);
    if (stmt) console.log(`    ${String(stmt).slice(0, 300)}`);
  }
}
