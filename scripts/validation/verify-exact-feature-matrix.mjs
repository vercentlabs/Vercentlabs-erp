#!/usr/bin/env node
// Prompt 15, Part 26: validates docs/implementation/ERP_EXACT_FEATURE_MATRIX_015.csv
// against the exact-count/structural invariants Prompt 15 requires. Static
// analysis only — no live database contacted, matching this repo's
// established verify-*-structure.mjs precedent.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const csvPath = path.join(root, "docs/implementation/ERP_EXACT_FEATURE_MATRIX_015.csv");

const EXPECTED_MODULE_COUNTS = {
  CRM: 74,
  Sales: 76,
  Procurement: 79,
  "Stock and Warehouse Management": 90,
  "HR & Payroll": 108,
  "Support and Customer Service": 75,
  "Quality Management": 77,
  "Point of Sale": 89,
  Assets: 73,
  Projects: 86,
  Manufacturing: 118,
};
const EXPECTED_MODULE_TOTAL = 945;
const EXPECTED_SHARED_TOTAL = 94;
const EXPECTED_GRAND_TOTAL = 1039;

const VALID_STATUS = new Set(["COMPLETE", "PARTIAL", "FOUNDATION_ONLY", "UI_ONLY", "MISSING", "UNVERIFIED"]);
const VALID_UAT = new Set(["READY", "LIMITED", "NOT_READY", "BLOCKED"]);
const VALID_PRIORITY = new Set(["P0", "P1", "P2", "P3"]);
const PROMPT_RANGE = { min: 16, max: 102 };

// Minimal RFC4180-ish CSV parser sufficient for our own escaper's output
// (quoted fields, doubled internal quotes, commas/newlines inside quotes).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // skip
    } else {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

let failures = 0;
function check(condition, message) {
  if (condition) {
    console.log(`OK    ${message}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${message}`);
  }
}

function main() {
  if (!fs.existsSync(csvPath)) {
    console.error(`FAIL  ${csvPath} does not exist`);
    process.exit(1);
  }
  const text = fs.readFileSync(csvPath, "utf8");
  const table = parseCsv(text);
  const header = table[0];
  const dataRows = table.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));

  check(dataRows.length === EXPECTED_GRAND_TOTAL, `Historical rows: ${dataRows.length} (expected ${EXPECTED_GRAND_TOTAL})`);

  const moduleRows = dataRows.filter((r) => r.scope === "module");
  const sharedRows = dataRows.filter((r) => r.scope === "shared");
  const accountingRows = dataRows.filter((r) => /accounting/i.test(r.module));
  check(moduleRows.length === EXPECTED_MODULE_TOTAL, `Module-specific: ${moduleRows.length} (expected ${EXPECTED_MODULE_TOTAL})`);
  check(sharedRows.length === EXPECTED_SHARED_TOTAL, `Shared: ${sharedRows.length} (expected ${EXPECTED_SHARED_TOTAL})`);
  check(accountingRows.length === 0, `Accounting in historical matrix: ${accountingRows.length} (expected 0)`);

  for (const [moduleName, expected] of Object.entries(EXPECTED_MODULE_COUNTS)) {
    const actual = moduleRows.filter((r) => r.module === moduleName).length;
    check(actual === expected, `Module "${moduleName}": ${actual} (expected ${expected})`);
  }

  const ids = dataRows.map((r) => r.feature_id);
  const idSet = new Set(ids);
  const duplicateIds = ids.length - idSet.size;
  check(duplicateIds === 0, `Duplicate IDs: ${duplicateIds}`);

  const emptyNames = dataRows.filter((r) => !r.feature_name || !r.feature_name.trim());
  check(emptyNames.length === 0, `Feature names non-empty: ${emptyNames.length} empty`);

  const invalidStatus = dataRows.filter((r) => !VALID_STATUS.has(r.status));
  check(invalidStatus.length === 0, `Invalid statuses: ${invalidStatus.length}`);

  const invalidUat = dataRows.filter((r) => !VALID_UAT.has(r.uat_status));
  check(invalidUat.length === 0, `Invalid UAT statuses: ${invalidUat.length}`);

  const invalidPriority = dataRows.filter((r) => !VALID_PRIORITY.has(r.priority));
  check(invalidPriority.length === 0, `Invalid priority values: ${invalidPriority.length}`);

  const incompleteWithoutGap = dataRows.filter((r) => r.status !== "COMPLETE" && !r.primary_gap.trim());
  check(incompleteWithoutGap.length === 0, `Incomplete rows without a primary_gap: ${incompleteWithoutGap.length}`);

  const incompleteWithoutPrompt = dataRows.filter((r) => r.status !== "COMPLETE" && !r.recommended_prompt.trim());
  check(incompleteWithoutPrompt.length === 0, `Incomplete rows without a future-prompt mapping: ${incompleteWithoutPrompt.length}`);

  const promptOutOfRange = dataRows.filter((r) => {
    if (!r.recommended_prompt.trim()) return false;
    return r.recommended_prompt.split(/[,;]\s*/).some((token) => {
      const n = Number(token);
      return !Number.isInteger(n) || n < PROMPT_RANGE.min || n > PROMPT_RANGE.max;
    });
  });
  check(promptOutOfRange.length === 0, `recommended_prompt values outside ${PROMPT_RANGE.min}-${PROMPT_RANGE.max}: ${promptOutOfRange.length}`);

  // Exact source order retained: historical_index must be 1..1039 with no
  // gaps/dupes, and increasing monotonically through the CSV as written.
  const indices = dataRows.map((r) => Number(r.historical_index));
  const sortedCopy = [...indices].sort((a, b) => a - b);
  const isMonotonic = indices.every((v, i) => i === 0 || v > indices[i - 1]);
  const isExactRange = sortedCopy.every((v, i) => v === i + 1);
  check(isMonotonic && isExactRange, `historical_index is 1..${EXPECTED_GRAND_TOTAL} with no gaps/dupes, in source order`);

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"}: ${failures} failing check(s)`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
