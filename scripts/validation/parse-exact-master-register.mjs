#!/usr/bin/env node
// Prompt 15, Part 1: deterministic parser for the recovered exact 1,039-
// feature master register (docs/product/
// VERCENTLABS_ERP_EXACT_1039_MASTER_REGISTER.md). Generates feature_id/
// module/category/number/name mechanically from the canonical document's
// own markdown structure — never manually transcribed — so counts and
// wording can never silently drift from the source file.
//
// Usage: node scripts/validation/parse-exact-master-register.mjs
// Writes: scripts/validation/.generated/exact-master-register.json
// (an intermediate artifact merged with classification data by
// scripts/validation/build-exact-feature-matrix.mjs — this script does
// NOT decide status/uat_status/priority, only parses feature identity.)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourcePath = path.join(root, "docs/product/VERCENTLABS_ERP_EXACT_1039_MASTER_REGISTER.md");
const outDir = path.join(root, "scripts/validation/.generated");
const outPath = path.join(outDir, "exact-master-register.json");

// Stable prefixes, matching Prompt 11's ERP_FEATURE_MATRIX_011.csv module
// prefixes for cross-reference ease.
const MODULE_PREFIX = {
  "CRM": "CRM",
  "Sales": "SALES",
  "Procurement": "PROC",
  "Stock and Warehouse Management": "STOCK",
  "HR & Payroll": "HR",
  "Support and Customer Service": "SUP",
  "Quality Management": "QUAL",
  "Point of Sale": "POS",
  "Assets": "ASSET",
  "Projects": "PROJ",
  "Manufacturing": "MFG",
};

function pad3(n) {
  return String(n).padStart(3, "0");
}

function parse(source) {
  const moduleListStart = source.indexOf("# Module feature lists");
  const sharedStart = source.indexOf("# Shared SaaS and enterprise platform requirements");
  const validationStart = source.indexOf("## Validation totals");
  if (moduleListStart === -1 || sharedStart === -1 || validationStart === -1) {
    throw new Error("Could not locate expected top-level anchors in the source document.");
  }

  const moduleSection = source.slice(moduleListStart, sharedStart);
  const sharedSection = source.slice(sharedStart, validationStart);

  const rows = [];
  let historicalIndex = 0;

  // --- Module-specific features (## module header, ### category header) ---
  const moduleHeaderRe = /^## \d+\.\s+(.+?)\s+—\s+(\d+)\s+features\s*$/gm;
  const moduleBlocks = [];
  let match;
  const moduleMatches = [];
  while ((match = moduleHeaderRe.exec(moduleSection))) {
    moduleMatches.push({ name: match[1].trim(), declaredCount: Number(match[2]), index: match.index, headerLength: match[0].length });
  }
  for (let i = 0; i < moduleMatches.length; i++) {
    const start = moduleMatches[i].index + moduleMatches[i].headerLength;
    const end = i + 1 < moduleMatches.length ? moduleMatches[i + 1].index : moduleSection.length;
    moduleBlocks.push({ name: moduleMatches[i].name, declaredCount: moduleMatches[i].declaredCount, body: moduleSection.slice(start, end) });
  }

  for (const block of moduleBlocks) {
    const prefix = MODULE_PREFIX[block.name];
    if (!prefix) throw new Error(`No stable prefix mapped for module "${block.name}" — update MODULE_PREFIX.`);
    const categoryHeaderRe = /^### (.+?)\s+—\s+(\d+)\s*$/gm;
    const categoryMatches = [];
    let categoryMatch;
    while ((categoryMatch = categoryHeaderRe.exec(block.body))) {
      categoryMatches.push({ name: categoryMatch[1].trim(), declaredCount: Number(categoryMatch[2]), index: categoryMatch.index, headerLength: categoryMatch[0].length });
    }
    let moduleFeatureCount = 0;
    for (let i = 0; i < categoryMatches.length; i++) {
      const start = categoryMatches[i].index + categoryMatches[i].headerLength;
      const end = i + 1 < categoryMatches.length ? categoryMatches[i].index + categoryMatches[i].headerLength + (categoryMatches[i + 1].index - start) : block.body.length;
      const categoryBody = block.body.slice(start, i + 1 < categoryMatches.length ? categoryMatches[i + 1].index : block.body.length);
      const itemRe = /^- \[ \] \*\*(\d+)\.\*\*\s+(.+?)\s*$/gm;
      let itemMatch;
      let categoryFeatureCount = 0;
      while ((itemMatch = itemRe.exec(categoryBody))) {
        historicalIndex += 1;
        moduleFeatureCount += 1;
        categoryFeatureCount += 1;
        rows.push({
          feature_id: `${prefix}-${pad3(Number(itemMatch[1]))}`,
          historical_index: historicalIndex,
          scope: "module",
          module: block.name,
          category: categoryMatches[i].name,
          feature_number: Number(itemMatch[1]),
          feature_name: itemMatch[2].trim(),
          source_section: categoryMatches[i].name,
        });
      }
      if (categoryFeatureCount !== categoryMatches[i].declaredCount) {
        throw new Error(`Category "${categoryMatches[i].name}" in module "${block.name}" declared ${categoryMatches[i].declaredCount} but parsed ${categoryFeatureCount}.`);
      }
    }
    if (moduleFeatureCount !== block.declaredCount) {
      throw new Error(`Module "${block.name}" declared ${block.declaredCount} features but parsed ${moduleFeatureCount}.`);
    }
  }

  // --- Shared platform features (## area header, continuous 1..94 numbering) ---
  const sharedAreaHeaderRe = /^## (.+?)\s+—\s+(\d+)\s+features\s*$/gm;
  const sharedMatches = [];
  while ((match = sharedAreaHeaderRe.exec(sharedSection))) {
    sharedMatches.push({ name: match[1].trim(), declaredCount: Number(match[2]), index: match.index, headerLength: match[0].length });
  }
  let sharedFeatureCount = 0;
  for (let i = 0; i < sharedMatches.length; i++) {
    const start = sharedMatches[i].index + sharedMatches[i].headerLength;
    const end = i + 1 < sharedMatches.length ? sharedMatches[i + 1].index : sharedSection.length;
    const areaBody = sharedSection.slice(start, end);
    const itemRe = /^- \[ \] \*\*(\d+)\.\*\*\s+(.+?)\s*$/gm;
    let itemMatch;
    let areaCount = 0;
    while ((itemMatch = itemRe.exec(areaBody))) {
      historicalIndex += 1;
      areaCount += 1;
      sharedFeatureCount += 1;
      rows.push({
        feature_id: `SHARED-${pad3(Number(itemMatch[1]))}`,
        historical_index: historicalIndex,
        scope: "shared",
        module: "Shared",
        category: sharedMatches[i].name,
        feature_number: Number(itemMatch[1]),
        feature_name: itemMatch[2].trim(),
        source_section: sharedMatches[i].name,
      });
    }
    if (areaCount !== sharedMatches[i].declaredCount) {
      throw new Error(`Shared area "${sharedMatches[i].name}" declared ${sharedMatches[i].declaredCount} but parsed ${areaCount}.`);
    }
  }

  return { rows, moduleFeatureTotal: historicalIndex - sharedFeatureCount, sharedFeatureTotal: sharedFeatureCount };
}

function main() {
  const source = fs.readFileSync(sourcePath, "utf8");
  const { rows, moduleFeatureTotal, sharedFeatureTotal } = parse(source);

  const total = rows.length;
  console.log(`Parsed ${total} total feature rows (${moduleFeatureTotal} module-specific + ${sharedFeatureTotal} shared).`);

  const perModule = {};
  for (const row of rows) {
    if (row.scope !== "module") continue;
    perModule[row.module] = (perModule[row.module] || 0) + 1;
  }
  console.log("Per-module counts:");
  for (const [name, count] of Object.entries(perModule)) console.log(`  ${name}: ${count}`);

  const perSharedArea = {};
  for (const row of rows) {
    if (row.scope !== "shared") continue;
    perSharedArea[row.category] = (perSharedArea[row.category] || 0) + 1;
  }
  console.log("Per-shared-area counts:");
  for (const [name, count] of Object.entries(perSharedArea)) console.log(`  ${name}: ${count}`);

  if (total !== 1039) throw new Error(`Expected 1039 total rows, parsed ${total}.`);
  if (moduleFeatureTotal !== 945) throw new Error(`Expected 945 module-specific rows, parsed ${moduleFeatureTotal}.`);
  if (sharedFeatureTotal !== 94) throw new Error(`Expected 94 shared rows, parsed ${sharedFeatureTotal}.`);

  const ids = new Set();
  for (const row of rows) {
    if (ids.has(row.feature_id)) throw new Error(`Duplicate feature_id generated: ${row.feature_id}`);
    ids.add(row.feature_id);
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(rows, null, 2));
  console.log(`\nOK — wrote ${outPath}`);
}

main();
