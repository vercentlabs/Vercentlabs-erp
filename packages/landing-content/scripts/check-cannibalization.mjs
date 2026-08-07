#!/usr/bin/env node
/**
 * Deterministic cannibalisation check — compares titles across every real
 * indexable route's content entry and flags exact or near-duplicate titles
 * for human review. This is advisory only: it never deletes or edits
 * anything, and always exits 0 — the brief is explicit that flagged
 * findings go to a human, not an auto-resolution ("flag for human review,
 * never auto-delete"). See docs/landing-redesign/phase-6/cannibalisation-review.md
 * for the last full manual review this script's findings were cross-checked against.
 */
import {
  LANDING_MODULES,
  PLATFORM_PAGES,
  LANDING_INDUSTRIES,
  LANDING_SOLUTIONS,
  LANDING_WORKFLOWS,
  ROUTED_WORKFLOW_SLUGS,
  RESOURCE_GUIDES,
  GLOSSARY_TERMS,
  VERCENTLABS_VS_ODOO,
} from "../src/index.js";

function normalize(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function collectEntries() {
  const entries = [];
  entries.push({ route: "/", title: "Home" });
  entries.push({ route: "/product", title: "Product" });
  entries.push({ route: "/modules", title: "Modules" });
  for (const m of LANDING_MODULES) entries.push({ route: `/modules/${m.key}`, title: m.name });
  for (const p of PLATFORM_PAGES) entries.push({ route: p.slug, title: p.title });
  entries.push({ route: "/industries", title: "Industries" });
  for (const i of LANDING_INDUSTRIES) entries.push({ route: `/industries/${i.slug}`, title: i.name });
  entries.push({ route: "/solutions", title: "Solutions" });
  for (const s of LANDING_SOLUTIONS) entries.push({ route: `/solutions/${s.slug}`, title: s.name });
  entries.push({ route: "/workflows", title: "Workflows" });
  for (const slug of ROUTED_WORKFLOW_SLUGS) {
    const workflow = LANDING_WORKFLOWS.find((w) => w.slug === slug);
    if (workflow) entries.push({ route: `/workflows/${slug}`, title: workflow.name });
  }
  entries.push({ route: "/implementation", title: "Implementation" });
  entries.push({ route: "/resources", title: "Resources" });
  for (const g of RESOURCE_GUIDES) entries.push({ route: `/resources/${g.slug}`, title: g.title });
  entries.push({ route: "/resources/glossary", title: "ERP Glossary" });
  for (const t of GLOSSARY_TERMS.filter((entry) => entry.standalone)) entries.push({ route: `/resources/glossary/${t.slug}`, title: t.term });
  entries.push({ route: "/compare", title: "Compare Vercentlabs" });
  entries.push({ route: `/compare/${VERCENTLABS_VS_ODOO.slug}`, title: `Vercentlabs vs. ${VERCENTLABS_VS_ODOO.competitor}` });
  return entries;
}

function run() {
  const entries = collectEntries();
  const byNormalizedTitle = new Map();
  for (const entry of entries) {
    const key = normalize(entry.title);
    if (!byNormalizedTitle.has(key)) byNormalizedTitle.set(key, []);
    byNormalizedTitle.get(key).push(entry);
  }

  const collisions = [...byNormalizedTitle.entries()].filter(([, group]) => group.length > 1);

  console.log(`Cannibalisation check: ${entries.length} routes scanned.`);
  if (collisions.length === 0) {
    console.log("No exact or near-duplicate titles found. See docs/landing-redesign/phase-6/cannibalisation-review.md for the last full manual intent review.");
    return;
  }

  console.log(`\n${collisions.length} title collision(s) found — flagged for human review, not auto-resolved:\n`);
  for (const [normalized, group] of collisions) {
    console.log(`  "${normalized}":`);
    for (const entry of group) {
      console.log(`    - ${entry.route}  ("${entry.title}")`);
    }
  }
  console.log("\nReview each group against docs/landing-redesign/phase-6/search-intent-ownership.md before changing anything.");
}

run();
