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
