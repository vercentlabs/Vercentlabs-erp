#!/usr/bin/env node
/**
 * Freshness lifecycle report — flags any route whose CONTENT_FRESHNESS
 * lastReviewedAt has exceeded its review interval. Comparisons get the
 * shortest interval (competitor pricing/features change fast); glossary
 * gets the longest (stable, evergreen definitions). See
 * docs/landing-redesign/phase-6/freshness-and-sitemap-policy.md for the
 * rationale behind each interval. This is a report only — it never edits
 * CONTENT_FRESHNESS or bumps a date itself; a human reviews the flagged
 * route and updates the entry with a real reviewReason once actually
 * reviewed (see .claude/rules/landing-content.md rule 5: never bump
 * lastModifiedAt for a change that didn't happen).
 */
import { CONTENT_FRESHNESS } from "../src/index.js";

const REVIEW_INTERVALS_DAYS = [
  { prefix: "/compare", days: 30, label: "Comparisons" },
  { prefix: "/resources/glossary", days: 180, label: "Glossary" },
  { prefix: "/resources", days: 90, label: "Resource guides" },
  { prefix: "/", days: 120, label: "Product/platform/industry/solution/workflow pages" },
];

function intervalFor(path) {
  for (const rule of REVIEW_INTERVALS_DAYS) {
    if (path.startsWith(rule.prefix) && rule.prefix !== "/") return rule;
  }
  return REVIEW_INTERVALS_DAYS[REVIEW_INTERVALS_DAYS.length - 1];
}

function daysSince(isoDate, now) {
  const then = new Date(`${isoDate}T00:00:00Z`).getTime();
  return Math.floor((now.getTime() - then) / (1000 * 60 * 60 * 24));
}

function run() {
  const now = new Date();
  const stale = [];

  for (const [path, freshness] of Object.entries(CONTENT_FRESHNESS)) {
    const rule = intervalFor(path);
    const age = daysSince(freshness.lastReviewedAt, now);
    if (age > rule.days) {
      stale.push({ path, age, threshold: rule.days, label: rule.label });
    }
  }

  const totalRoutes = Object.keys(CONTENT_FRESHNESS).length;
  console.log(`Freshness check: ${totalRoutes} routes with a CONTENT_FRESHNESS entry, checked against per-category review intervals.`);
  console.log(REVIEW_INTERVALS_DAYS.map((r) => `  ${r.label}: review every ${r.days} days`).join("\n"));

  if (stale.length === 0) {
    console.log("\nNo overdue routes. Nothing needs re-review right now.");
    return;
  }

  console.log(`\n${stale.length} route(s) overdue for review:\n`);
  for (const entry of stale.sort((a, b) => b.age - a.age)) {
    console.log(`  ${entry.path} — last reviewed ${entry.age} days ago (threshold: ${entry.threshold} days, ${entry.label})`);
  }
}

run();
