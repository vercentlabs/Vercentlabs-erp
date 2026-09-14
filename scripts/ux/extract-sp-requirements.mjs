#!/usr/bin/env node
// Phase 0b (docs/ux/UI_REWRITE_TRACKER.md): extracts atomic requirements from
// the 36 SP shared-platform dossiers (docs/04-shared-platform/requirements/
// SP0##-*.md) into docs/04-shared-platform/SP_SUBREQUIREMENT_REGISTER.csv,
// so SP requirements can be verified the same way F001-F510's
// SUBREQUIREMENT_REGISTER.csv already is.
//
// GROUND TRUTH, established by reading the real files before writing this
// parser (do not "fix" this comment to match a nicer-sounding number than
// what is actually true): all 36 dossiers share one exact 54-section
// template. Only 3 of those 54 sections DECLARE genuinely enumerated atomic
// requirement IDs (matching the F-register's own SP###-TYPE-### shape):
//   [SPEC-FUNCTIONAL] -> 3 IDs, SP0##-FR-001..003
//   [SPEC-E2E]         -> 2 IDs, SP0##-TEST-E2E-01..02
//   [SPEC-UAT]         -> 2 IDs, SP0##-UAT-01..02
// = 7 declared atomic requirements per dossier, 252 total, uniform across
// all 36 files (verified directly, not assumed, before this script existed).
// A handful of those same IDs are also *cross-referenced by number* in
// later prose sections (e.g. "[SPEC-VALIDATION]" citing "SP0##-FR-002" as
// the rule being validated) -- those are NOT additional requirements; this
// script attributes each unique ID to its first (declaring) occurrence only
// and does not double-count a cross-reference as a second requirement.
//
// The other 51 sections are real, substantive, human-authored normative
// prose -- but NOT broken into individually numbered atomic requirements
// the way SUBREQUIREMENT_REGISTER.csv's rows are. Inventing per-clause IDs
// inside that prose would be fabrication. Instead, each such section
// becomes exactly ONE row, with a requirement_id deliberately built from a
// "SECTION" marker (e.g. `SP001-SECTION-SECURITY`) that can never collide
// with, or be mistaken for, a genuinely-declared ID -- this is "recording
// the true situation" (one real requirement section per row) rather than
// fabricating false granularity.
//
// Every row's normative_statement is the section's own real prose,
// verbatim -- never generated/paraphrased text.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeCsv } from "./csv.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const dossierDir = path.join(root, "docs/04-shared-platform/requirements");
const outPath = path.join(root, "docs/04-shared-platform/SP_SUBREQUIREMENT_REGISTER.csv");

const files = fs.readdirSync(dossierDir).filter((f) => /^SP\d{3}-.*\.md$/.test(f)).sort();
if (files.length !== 36) {
  throw new Error(`Expected exactly 36 SP dossiers, found ${files.length}: ${files.join(", ")}`);
}

const ID_PATTERN = /SP(\d{3})-([A-Z0-9-]+)-(\d+)/g;
const HEADER = [
  "requirement_id", "sp_id", "requirement_family", "enumerated", "title",
  "normative_statement", "priority", "category", "dependencies", "source_dossier",
];

const rows = [];

for (const file of files) {
  const spId = file.slice(0, 5); // "SP001"
  const text = fs.readFileSync(path.join(dossierDir, file), "utf8");
  const relPath = path.relative(root, path.join(dossierDir, file)).split(path.sep).join("/");

  const categoryMatch = text.match(/Category:\s*\*\*([^*]+)\*\*/);
  const priorityMatch = text.match(/Priority:\s*\*\*([^*]+)\*\*/);
  const category = categoryMatch ? categoryMatch[1].trim() : "";
  const priority = priorityMatch ? priorityMatch[1].trim() : "";

  const dependsSection = text.match(/## \[SPEC-RELATED\][^\n]*\n([\s\S]*?)(?=\n## \[|$)/);
  const dependsText = dependsSection ? dependsSection[1].trim() : "";
  const dependsIds = [...dependsText.matchAll(/SP\d{3}/g)].map((m) => m[0]);
  const dependencies = dependsIds.length ? [...new Set(dependsIds)].join(";") : "";

  // Split into [SPEC-SLUG] Title sections IN DOCUMENT ORDER, capturing each
  // section's start offset in the raw text so a later step can determine
  // which section "owns" the first (declaring) occurrence of each ID.
  const sectionPattern = /## \[SPEC-([A-Z0-9-]+)\]\s*([^\n]*)\n([\s\S]*?)(?=\n## \[SPEC-|$)/g;
  const sections = [];
  let match;
  while ((match = sectionPattern.exec(text))) {
    sections.push({ slug: match[1], title: match[2].trim(), body: match[3].trim(), start: match.index, ids: [] });
  }
  if (sections.length !== 54) {
    throw new Error(`${file}: expected 54 [SPEC-*] sections, found ${sections.length}`);
  }

  // First (declaring) occurrence of each unique ID wins -- a later
  // cross-reference to the same ID in a different section is not a second
  // requirement.
  const seenIds = new Set();
  for (const idMatch of text.matchAll(ID_PATTERN)) {
    const [full, sp, family] = idMatch;
    if (family.startsWith("SRC") || `SP${sp}` !== spId || seenIds.has(full)) continue;
    seenIds.add(full);
    const offset = idMatch.index;
    // Section containing this offset = last section whose start <= offset.
    let owner = sections[0];
    for (const section of sections) {
      if (section.start <= offset) owner = section;
      else break;
    }
    owner.ids.push({ full, family });
  }

  for (const section of sections) {
    if (section.ids.length > 0) {
      for (const id of section.ids) {
        rows.push({
          requirement_id: id.full,
          sp_id: spId,
          requirement_family: id.family,
          enumerated: "TRUE",
          title: section.title,
          normative_statement: section.body,
          priority,
          category,
          dependencies,
          source_dossier: relPath,
        });
      }
    } else {
      rows.push({
        requirement_id: `${spId}-SECTION-${section.slug}`,
        sp_id: spId,
        requirement_family: "SECTION",
        enumerated: "FALSE",
        title: section.title,
        normative_statement: section.body,
        priority,
        category,
        dependencies,
        source_dossier: relPath,
      });
    }
  }
}

fs.writeFileSync(outPath, writeCsv(HEADER, rows));

const enumerated = rows.filter((r) => r.enumerated === "TRUE").length;
const sectionLevel = rows.filter((r) => r.enumerated === "FALSE").length;
console.log(`Extracted ${rows.length} SP requirement rows from ${files.length} dossiers -> ${path.relative(root, outPath)}`);
console.log(`  enumerated (real atomic IDs declared in dossier text): ${enumerated}`);
console.log(`  section-level (real prose, no per-clause ID in source): ${sectionLevel}`);
if (enumerated !== files.length * 7) {
  console.warn(`  WARNING: expected exactly ${files.length * 7} enumerated IDs (7 per dossier); got ${enumerated}. Investigate before trusting this run.`);
}
