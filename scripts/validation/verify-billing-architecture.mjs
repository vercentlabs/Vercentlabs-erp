#!/usr/bin/env node
// `pnpm verify:billing` (static half): SaaS billing architecture invariants.
// Reads source only; the unit tests it is paired with run the pure rules.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(root, relative));

function walk(relative, filter, out = []) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) return out;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if ([".next", "node_modules", "e2e", "tests"].includes(entry.name)) continue;
    const child = path.join(relative, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) walk(child, filter, out);
    else if (filter(child)) out.push(child);
  }
  return out;
}

const problems = [];
const section = (label, found) => {
  if (found.length) for (const problem of found) console.error(`FAIL  ${label}: ${problem}`);
  else console.log(`OK    ${label}`);
  problems.push(...found);
};

const BILLING = "services/api/src/core/billing";
const ADAPTER = `${BILLING}/providers/razorpay.js`;
const sourceFiles = [...walk("services", (f) => /\.(js|mjs)$/.test(f)), ...walk("apps/web/src", (f) => /\.(ts|tsx)$/.test(f)), ...walk("packages", (f) => /\.(js|ts)$/.test(f))];

// 1. One provider client.
section(
  "Razorpay is reached only through the provider adapter",
  sourceFiles.filter((file) => file !== ADAPTER && /api\.razorpay\.com/.test(read(file))).map((file) => `${file} references the Razorpay API directly`),
);

// 2. One billing domain: no flat billing implementations outside the boundary.
section(
  "billing lives behind services/api/src/core/billing/",
  ["billing.js", "razorpay.js", "subscription-billing.js", "entitlements.js"].map((name) => `services/api/src/core/${name}`).filter(exists).map((file) => `${file} must not exist (moved into the billing boundary)`),
);
section(
  "billing code outside the boundary imports it only through its index",
  sourceFiles
    .filter((file) => !file.startsWith(`${BILLING}/`))
    .filter((file) => /core\/billing\/(?!index\.js)[\w/-]+\.js/.test(read(file)))
    .map((file) => `${file} imports a private billing module`),
);

// 3. Authenticated Billing routes use workspaceRoute with an explicit billing permission and never the billing write gate.
const routes = walk("apps/web/src/app/api/billing", (file) => file.endsWith("/route.ts"));
const routeProblems = [];
for (const file of routes) {
  const source = read(file);
  if (file.endsWith("/webhook/route.ts")) {
    if (/workspaceRoute|requireWorkspace|requireApiWorkspace/.test(source)) routeProblems.push(`${file}: the provider webhook is HMAC-authenticated, never session-authenticated`);
    if (!/ingestBillingWebhook/.test(source)) routeProblems.push(`${file}: the webhook route must only ingest (worker applies)`);
    if (/processClaimedWebhookEvent|applyWebhookEventInTx/.test(source)) routeProblems.push(`${file}: webhook processing belongs to the worker`);
    continue;
  }
  if (!/\bworkspaceRoute\s*\(/.test(source)) routeProblems.push(`${file}: must use workspaceRoute()`);
  if (!/BILLING_PERMISSIONS\.(view|manage|checkout|audit)/.test(source)) routeProblems.push(`${file}: must name an explicit billing permission`);
  if (/billingWrite\s*:\s*true/.test(source)) routeProblems.push(`${file}: billing routes must not depend on the billing write gate`);
  if (/requireBillingWriteAccess/.test(source)) routeProblems.push(`${file}: billing fixes billing; it cannot require write access`);
}
if (exists("apps/web/src/app/api/billing/retry/route.ts")) routeProblems.push("the cron-secret retry endpoint is retired; the worker owns billing retries");
if (exists("apps/web/src/features/billing/server.ts")) routeProblems.push("features/billing/server.ts duplicated route security; use workspaceRoute");
section("billing routes: workspaceRoute + explicit permissions, no write gate, ingestion-only webhook", routeProblems);

// 4. No provider HTTP inside a transaction: saga routes must not run in a route-level transaction.
section(
  "provider-calling billing routes do not wrap the saga in a transaction",
  ["checkout", "verify", "seats", "cancel", "sync"]
    .map((name) => `apps/web/src/app/api/billing/${name}/route.ts`)
    .filter((file) => !/transaction:\s*"none"/.test(read(file)))
    .map((file) => `${file} must use transaction: "none" (the saga commits before calling the provider)`),
);

// 5. Commercial catalogue integrity: code constants match the migration that created the current versions.
const catalogue = read(`${BILLING}/catalogue.js`);
const migration = read("database/platform/migrations/061_billing_commercial_model_and_recovery.sql");
const catalogueProblems = [];
if (!/free: Object\.freeze\(\{ code: "free", includedUsers: 1/.test(catalogue)) catalogueProblems.push("COMMERCIAL_MODEL.free must include 1 user");
if (!/perAdditionalUserPaise: 100000/.test(catalogue)) catalogueProblems.push("COMMERCIAL_MODEL.standard must be 100000 paise per additional user");
if (!/\('standard', 100000::bigint\)/.test(migration) || !/SELECT plan\.id, 'monthly', 'INR', terms\.amount_paise, 0, 2, 1, true/.test(migration)) catalogueProblems.push("migration 061 must create Standard v2 at 100000 paise with 1 included user");
if (!/CREATE TRIGGER billing_plan_prices_immutable/.test(migration)) catalogueProblems.push("price versions must be protected by the immutability trigger");
section("commercial catalogue and immutable price versions", catalogueProblems);

// 6. Shared audit only; money never as floating point in billing code.
const billingFiles = walk(BILLING, (file) => file.endsWith(".js"));
section(
  "billing audits through the shared audit primitive",
  billingFiles.filter((file) => /INSERT INTO audit_events/.test(read(file))).map((file) => `${file} writes audit_events directly`),
);
section(
  "billing money stays integer paise",
  billingFiles.filter((file) => /parseFloat|toFixed\(/.test(read(file))).map((file) => `${file} uses floating-point money helpers`),
);

// 7. Honest customer-facing language.
const webBilling = walk("apps/web/src/features/billing", (file) => /\.(ts|tsx)$/.test(file));
section(
  "no unverified payment or tax claims in the Billing UI",
  webBilling.flatMap((file) => {
    const source = read(file);
    const found = [];
    if (/not (been )?charged/i.test(source) && !/never tell someone they were not charged/i.test(source)) found.push(`${file}: never claims "not charged"`);
    if (/GST invoice/i.test(source)) found.push(`${file}: provider documents are not GST tax invoices`);
    if (/replace\(\/_\/g/.test(source)) found.push(`${file}: status text must come from curated labels, not enum string munging`);
    return found;
  }),
);

// 8. The worker owns billing maintenance.
const worker = read("services/worker/src/worker.js");
const workerBilling = read("services/worker/src/billing-maintenance.js");
section(
  "the worker runs platform billing maintenance",
  [
    !/createBillingMaintenanceLoop\(/.test(worker) && "worker.js must start the billing maintenance loop",
    !/runBillingMaintenance\(/.test(workerBilling) && "billing-maintenance.js must call runBillingMaintenance",
    /withTenantClient\(|enqueueJob\(|claimJobs\(|runTenantTransaction\(/.test(workerBilling) && "billing maintenance must not use tenant context or tenant jobs",
  ].filter(Boolean),
);

if (problems.length) {
  console.error(`\nverify:billing found ${problems.length} problem(s).`);
  process.exit(1);
}
console.log("\nBilling architecture checks passed.");
