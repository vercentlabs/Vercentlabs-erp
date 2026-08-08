#!/usr/bin/env node
/**
 * Real Lighthouse baseline — Phase 7. Requires the real production standalone
 * server already running (never `next dev`; see package.json's
 * `start:standalone`). Runs both mobile and desktop presets against the 11
 * representative routes named in the governing Phase 7 brief, writes raw
 * JSON reports (gitignored, under test-results/) plus a machine-readable
 * summary.json this script also prints as a markdown table — the source
 * every number in docs/landing-redesign/phase-7/baseline-measurements.md
 * traces back to. No score in that doc is ever hand-typed from memory.
 *
 * Uses Lighthouse's programmatic Node API (not the `npx lighthouse` CLI via
 * a subprocess). The CLI-via-subprocess approach was tried first and is
 * fundamentally broken in this environment: on Windows, `npx` resolves to
 * `npx.cmd`, which `execFileSync` cannot spawn without `shell: true` (EINVAL);
 * but `shell: true` concatenates arguments WITHOUT quoting (Node itself
 * warns about this), and this repo's path contains a space
 * ("VERCENTLABS ERP"), which silently truncated --output-path on every run
 * and produced two different-looking downstream errors (EISDIR, then EPERM)
 * that traced back to this one root cause. The programmatic API avoids
 * subprocess/shell argument passing entirely.
 *
 * Usage:
 *   pnpm --filter @vercentlabs/landing lighthouse:baseline
 *   LIGHTHOUSE_BASE_URL=http://localhost:3000 LIGHTHOUSE_LABEL=cycle3 node scripts/lighthouse-baseline.mjs
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as chromeLauncher from "chrome-launcher";
import lighthouse from "lighthouse";

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const baseUrl = process.env.LIGHTHOUSE_BASE_URL ?? "http://localhost:3000";
const label = process.env.LIGHTHOUSE_LABEL ?? new Date().toISOString().replace(/[:.]/g, "-");
// Deliberately NOT under test-results/ — Playwright's default outputDir
// cleanup wipes that directory at the start of every `playwright test` run,
// which silently deleted a completed Lighthouse baseline the first time this
// ran alongside the E2E suite in the same session.
const outDir = path.join(appDir, ".lighthouse-reports", label);

const ROUTES = [
  "/",
  "/book-demo",
  "/product",
  "/modules/manufacturing",
  "/industries/manufacturing",
  "/workflows/lead-to-cash",
  "/implementation",
  "/resources",
  "/resources/erp-buying-guide",
  "/resources/erp-requirements-checklist",
  "/compare/vercentlabs-vs-odoo",
];

const FORM_FACTORS = ["mobile", "desktop"];

const DESKTOP_CONFIG = {
  extends: "lighthouse:default",
  settings: {
    formFactor: "desktop",
    screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
    throttling: {
      rttMs: 40,
      throughputKbps: 10240,
      cpuSlowdownMultiplier: 1,
      requestLatencyMs: 0,
      downloadThroughputKbps: 0,
      uploadThroughputKbps: 0,
    },
  },
};

function slugFor(route) {
  return route === "/" ? "home" : route.replace(/^\//, "").replace(/\//g, "-");
}

const MAX_ATTEMPTS = 3;

async function runLighthouseOnce(chrome, url, formFactor) {
  const options = {
    port: chrome.port,
    output: "json",
    onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
    logLevel: "error",
  };
  const config = formFactor === "desktop" ? DESKTOP_CONFIG : undefined;
  const runnerResult = await lighthouse(url, options, config);
  if (!runnerResult) throw new Error("Lighthouse returned no result");
  const report = JSON.parse(runnerResult.report);
  // Lighthouse can complete "successfully" (no thrown exception) while still
  // recording a runtimeError against the report itself — e.g. NO_NAVSTART,
  // a real, Lighthouse-documented transient trace-recording failure whose own
  // message says "Please run Lighthouse again." Left undetected, every
  // category score is `null`, and a naive `?? 0` fallback on the reading side
  // would misrepresent a failed run as a real, terrible score of 0 — found
  // happening for 6 of 22 routes in this project's first full run. Treat any
  // runtimeError as a failure so the retry loop below actually retries it.
  if (report.runtimeError) {
    throw new Error(`Lighthouse runtimeError ${report.runtimeError.code}: ${report.runtimeError.message}`);
  }
  return report;
}

async function runLighthouse(chrome, url, formFactor) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await runLighthouseOnce(chrome, url, formFactor);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        process.stdout.write(`(retry ${attempt}/${MAX_ATTEMPTS - 1} after: ${error.message.slice(0, 60)}...) `);
      }
    }
  }
  throw lastError;
}

function extractSummary(report, route, formFactor) {
  const categories = report.categories;
  const audits = report.audits;
  return {
    route,
    formFactor,
    performance: Math.round((categories.performance?.score ?? 0) * 100),
    accessibility: Math.round((categories.accessibility?.score ?? 0) * 100),
    bestPractices: Math.round((categories["best-practices"]?.score ?? 0) * 100),
    seo: Math.round((categories.seo?.score ?? 0) * 100),
    fcpMs: Math.round(audits["first-contentful-paint"]?.numericValue ?? 0),
    lcpMs: Math.round(audits["largest-contentful-paint"]?.numericValue ?? 0),
    tbtMs: Math.round(audits["total-blocking-time"]?.numericValue ?? 0),
    cls: Number((audits["cumulative-layout-shift"]?.numericValue ?? 0).toFixed(3)),
    speedIndexMs: Math.round(audits["speed-index"]?.numericValue ?? 0),
    ttfbMs: Math.round(audits["server-response-time"]?.numericValue ?? 0),
    lcpElement: audits["largest-contentful-paint-element"]?.details?.items?.[0]?.node?.snippet ?? null,
  };
}

async function main() {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  console.log(`Lighthouse baseline against ${baseUrl}, label "${label}"`);
  console.log(`${ROUTES.length} routes x ${FORM_FACTORS.length} form factors = ${ROUTES.length * FORM_FACTORS.length} runs\n`);

  const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless=new", "--no-sandbox"] });
  const results = [];

  try {
    for (const route of ROUTES) {
      for (const formFactor of FORM_FACTORS) {
        const slug = slugFor(route);
        const outputPath = path.join(outDir, `${slug}-${formFactor}.json`);
        const url = new URL(route, baseUrl).toString();
        process.stdout.write(`  ${formFactor.padEnd(7)} ${route} ... `);
        try {
          const report = await runLighthouse(chrome, url, formFactor);
          writeFileSync(outputPath, JSON.stringify(report));
          const summary = extractSummary(report, route, formFactor);
          results.push(summary);
          console.log(`perf=${summary.performance} a11y=${summary.accessibility} lcp=${summary.lcpMs}ms cls=${summary.cls}`);
        } catch (error) {
          console.log(`FAILED: ${error.message}`);
          results.push({ route, formFactor, error: error.message });
        }
      }
    }
  } finally {
    // chrome-launcher's temp-profile-directory cleanup can throw EPERM on
    // Windows (a locked file, often antivirus-related) even though the run
    // itself completed fine. Don't let that mask real results.
    try {
      await chrome.kill();
    } catch {
      // best-effort cleanup only
    }
  }

  const summaryPath = path.join(outDir, "summary.json");
  writeFileSync(summaryPath, JSON.stringify({ baseUrl, label, generatedAt: new Date().toISOString(), results }, null, 2));
  console.log(`\nWrote ${results.length} results to ${summaryPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
