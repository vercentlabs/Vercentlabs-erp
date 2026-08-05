import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const read = (relativePath) =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

const workspacePages = [
  "ai-intelligence",
  "communications",
  "conversation-intelligence",
  "customer-success",
  "lead-acquisition",
  "lead-intelligence",
  "marketing",
  "opportunity-revenue",
  "partner-engagement",
];

test("advanced CRM pages use the canonical workbench and operational actions", () => {
  for (const area of workspacePages) {
    const source = read(`apps/web/src/app/(app)/crm/${area}/page.tsx`);
    assert.match(source, /CrmWorkspaceShell/);
    assert.match(source, /CrmActionWorkbench/);
    assert.match(source, /AccessDenied/);
    assert.doesNotMatch(source, /return null;/);
    assert.doesNotMatch(source, /return notFound\(\)/);
  }
});

test("lead acquisition examples use supported lead identity fields", () => {
  const source = read("apps/web/src/app/(app)/crm/lead-acquisition/page.tsx");

  assert.doesNotMatch(source, /fullName/);
  for (const mapping of [
    'firstName: "first_name"',
    'lastName: "last_name"',
    'companyName: "company"',
    'jobTitle: "job_title"',
  ]) {
    assert.match(source, new RegExp(mapping));
  }
  assert.match(source, /rahul\.crmtest01@example\.com/);
  assert.match(source, /neha\.crmtest02@example\.com/);
  assert.match(source, /name: "acceptedKeys"/);
  assert.match(source, /Review \{String\(row\.id\)\}/);
});

test("CRM product CSS is scoped and imported last", () => {
  const css = read("apps/web/src/app/crm-product.css");
  const layout = read("apps/web/src/app/layout.tsx");
  assert.match(css, /\.crm-product-shell/);
  assert.doesNotMatch(css, /^:root\s*\{/m);
  assert.ok(
    layout.indexOf('import "./crm-product.css";') >
      layout.indexOf('import "./enterprise-modules.css";'),
  );
});

test("CRM workspace metrics use neutral vertical spacing", () => {
  const css = read("apps/web/src/app/crm-product.css");

  assert.match(
    css,
    /\.crm-product-metric\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)[^}]*gap:\s*8px[^}]*padding:\s*18px/s,
  );
  for (const tone of ["success", "warning", "danger"]) {
    assert.match(
      css,
      new RegExp(
        `\\.crm-product-metric\\.${tone}\\s*\\{[^}]*border-color:\\s*var\\(--color-line\\)`,
        "s",
      ),
    );
  }
  assert.match(
    css,
    /\.crm-standard-shell \.crm-product-metric:hover\s*\{[^}]*border-color:\s*var\(--color-line\)/s,
  );
});

test("CRM action fields align without stretching paired controls", () => {
  const css = read("apps/web/src/app/crm-product.css");

  assert.match(
    css,
    /\.crm-action-fields\s*\{[^}]*align-items:\s*start[^}]*column-gap:\s*18px[^}]*row-gap:\s*18px/s,
  );
  assert.match(
    css,
    /\.crm-action-field\s*\{[^}]*grid-auto-rows:\s*max-content[^}]*align-content:\s*start[^}]*align-self:\s*start/s,
  );
  assert.match(
    css,
    /\.crm-action-field > span\s*\{[^}]*align-items:\s*center[^}]*line-height:\s*18px/s,
  );
});

test("CRM action form reclaims desktop space without shifting mobile cards", () => {
  const css = read("apps/web/src/app/crm-product.css");

  assert.match(
    css,
    /@media \(min-width: 1101px\)\s*\{\s*\.crm-standard-shell \.crm-action-form\s*\{\s*margin-top:\s*-8px;/s,
  );
});

test("every CRM route family inherits the dashboard design language", () => {
  const css = read("apps/web/src/app/crm-product.css");
  const crmLayout = read("apps/web/src/app/(app)/crm/layout.tsx");

  assert.match(crmLayout, /crm-standard-shell crm-workbench/);
  for (const selector of [
    ".page-heading",
    ".module-hero",
    ".module-metric-card",
    ".business-data-layout",
    ".crm-resource-layout",
    ".crm-detail-list",
    ".crm-timeline",
    ".crm-kanban-column",
    ".crm-report-grid",
    ".settings-grid",
  ]) {
    assert.match(
      css,
      new RegExp(`\\.crm-standard-shell \\${selector.replace(".", ".")}`),
      selector,
    );
  }
  assert.match(css, /@media \(max-width: 960px\)/);
  assert.match(css, /@media \(max-width: 720px\)/);
});

test("CRM operational action component submits resilient requests, validates and refreshes", () => {
  const source = read("apps/web/src/components/crm/crm-action-workbench.tsx");
  assert.match(source, /requestJson<Record<string, unknown>>\(endpoint/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.match(source, /JSON\.parse/);
  assert.match(source, /router\.refresh\(\)/);
  assert.match(source, /aria-live/);
});

test("provider worker claims every missing CRM provider queue", () => {
  const source = read("apps/web/scripts/process-crm-provider-jobs.mjs");
  assert.match(source, /crm_telephony_commands/);
  assert.match(source, /crm_transcription_jobs/);
  assert.match(source, /crm_provider_sync_jobs/);
  assert.match(source, /FOR UPDATE SKIP LOCKED/);
  assert.match(source, /dead_letter/);
  assert.match(source, /Mock telephony is forbidden in production/);
  assert.match(source, /Mock transcription is forbidden in production/);
});

test("provider-backed AI remains grounded and human approved", () => {
  const provider = read("apps/web/src/lib/crm-ai-provider.ts");
  const route = read("apps/web/src/app/api/crm/ai-intelligence/route.ts");
  const service = read("services/api/src/crm/ai-intelligence.js");
  assert.match(provider, /factualOnly/);
  assert.match(provider, /humanApprovalRequired/);
  assert.match(route, /draft-provider/);
  assert.match(service, /generatedBody/);
  assert.match(service, /requiresHumanApproval: true/);
});

test("CRM evidence verifier validates real files and production receipts", () => {
  const source = read("scripts/validation/verify-crm-product-completion.mjs");
  assert.match(source, /missingPaths/);
  assert.match(source, /CRM_PROVIDER_ACCEPTANCE_FILE/);
  assert.match(source, /receiptHash/);
  assert.match(source, /externalProviderRequiredCapabilities/);
});

test("CRM product acceptance schema is tenant isolated and immutable", () => {
  const migration = read(
    "database/tenant/migrations/042_crm_product_acceptance.sql",
  );
  assert.match(migration, /crm_product_acceptance_runs/);
  assert.match(migration, /crm_provider_execution_receipts/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /crm_product_acceptance_immutable/);
});
