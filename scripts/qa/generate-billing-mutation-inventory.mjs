// SP011 Section 3 — a complete, evidence-based inventory of every
// mutation-capable route, classifying whether it is billing-write-gated
// (directly, or via a shared wrapper already known to be billing-gated)
// and a heuristic operation-type hint for manual classification. This is
// deliberately NOT an auto-decider: "no billing gate detected" does not
// mean "needs one" -- a security/recovery/billing-admin/export/webhook
// route must never be gated. A human (or an agent under explicit
// instruction) reviews the "unclassified" rows and decides.
import fs from "node:fs";
import path from "node:path";

const API_DIR = "apps/web/src/app/api";
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function detectMethods(source) {
  return HTTP_METHODS.filter(
    (method) =>
      new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\s*\\(`).test(source) ||
      new RegExp(`export\\s+const\\s+${method}\\s*=`).test(source),
  );
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name === "route.ts") files.push(full);
  }
  return files;
}

// Direct billing-gate detection: the route file itself calls
// requireBillingWriteAccess, OR it calls requireCrmMutationAccess (always
// billing-gated per crm-context.ts), OR it calls requireCrmAccess/
// requirePosAccess with an explicit { mutation: true } option.
function detectBillingGate(source) {
  if (/\brequireBillingWriteAccess\s*\(/.test(source)) return "direct";
  if (/\brequireCrmMutationAccess\s*\(/.test(source)) return "via-requireCrmMutationAccess";
  if (/\brequire(Crm|Pos)Access\s*\([^)]*\{\s*mutation:\s*true\s*\}/s.test(source)) return "via-mutation-option";
  // Shared Access route composition with its explicit billing write gate.
  if (/\bworkspaceRoute\s*\(/.test(source) && /\bbillingWrite:\s*true\b/.test(source)) return "via-workspaceRoute";
  return "none";
}

// Every CRM/POS mutation-capable route that is deliberately NOT
// billing-write-gated, with the specific, reviewed reason -- mirrors
// generate-route-security-matrix.mjs's DOCUMENTED_EXCEPTIONS pattern so a
// future route can never silently join this list; validate-billing-
// mutation-gate.mjs fails the build for any CRM/POS mutation route that is
// neither gated nor named here.
export const DOCUMENTED_EXCLUSIONS = Object.freeze({
  "api/crm/accounts/duplicates/route.ts": "Read-only duplicate search (findAccountDuplicates) -- no record is created or changed.",
  "api/crm/accounts/merge/preview/route.ts": "Read-only merge preview -- computes the would-be merged record, writes nothing.",
  "api/crm/contacts/duplicates/route.ts": "Read-only duplicate search (findContactDuplicates) -- mirrors accounts/duplicates exactly.",
  "api/crm/contacts/merge/preview/route.ts": "Read-only merge preview -- mirrors accounts/merge/preview exactly.",
  "api/crm/leads/duplicates/route.ts": "Read-only possible-duplicate check performed while composing a Lead -- never auto-merges, writes nothing.",
  "api/crm/leads/import/analyze/route.ts": "Step 0 of Lead import -- parses the uploaded CSV server-side and returns its headers/sample for column mapping; stores nothing. The commit step (leads/import/[batchId]/commit) is gated.",
  "api/crm/leads/import/preview/route.ts": "Preview stage of the two-step Lead import -- validates and stages rows for review; 'creates no Lead yet' per its own header comment. The commit step (leads/import/[batchId]/commit) is gated.",
  "api/crm/leads/export/route.ts": "Authorized data export -- exports must remain available regardless of subscription-write state, per this pass's explicit policy.",
  "api/crm/public/meetings/bookings/[token]/route.ts": "Public, token-authenticated prospect self-service -- no ERP session/subscription context applies (see ROUTE_SECURITY_MATRIX's own documented exception for the same route).",
  "api/crm/public/meetings/links/[token]/book/route.ts": "Public, token-authenticated prospect self-service -- same as above.",
  "api/pos/payments/webhook/[provider]/route.ts": "Payment-provider webhook, authenticated by cryptographic signature, not a session -- must remain reachable to record what the provider says happened regardless of the org's own subscription state (payment callbacks/reconciliation, not a business write initiated by the org).",
  "api/pos/reconciliations/[id]/correction/route.ts": "Financial record-keeping: correcting a reconciliation to reflect what already happened, not creating new business activity. A business must be able to correctly close its books regardless of subscription state.",
  "api/pos/reconciliations/[id]/resolve/route.ts": "Financial record-keeping -- same rationale as reconciliations/correction.",
  "api/pos/reports/day-end/[id]/accounting-post/route.ts": "Posts an already-finalized day-end report to accounting -- completes bookkeeping for transactions that already happened, not a new business write.",
  "api/pos/reports/day-end/[id]/reconciliation/route.ts": "Financial record-keeping for an already-closed day -- same rationale.",
  "api/pos/reports/day-end/[id]/finalize/route.ts": "Closes out an already-completed trading day's report -- record-keeping, not new business activity.",
  "api/pos/reports/day-end/[id]/review/route.ts": "Reviews an already-generated day-end report -- record-keeping.",
  "api/pos/reports/day-end/[id]/variance/route.ts": "Records a variance explanation against an already-closed day -- record-keeping.",
  "api/pos/reports/day-end/route.ts": "Generates a day-end report from already-completed sales -- a report, not new business activity (mirrors the export carve-out).",
  "api/pos/returns/[id]/accounting-post/route.ts": "Posts an already-approved return to accounting -- bookkeeping completion, not new business activity.",
  "api/pos/sales/[id]/accounting-post/route.ts": "Posts an already-completed sale to accounting -- bookkeeping completion, not new business activity.",
  "api/pos/sales/[id]/invoice/route.ts": "Generates a legal/compliance document (invoice) for an already-completed sale -- export/compliance-adjacent, must remain available.",
  "api/pos/settlements/route.ts": "Financial settlement record-keeping for already-completed payments -- not new business activity.",
});

// Heuristic only -- flags likely non-business-write categories by path/
// naming convention so a reviewer can triage faster, never auto-decides.
function heuristicCategory(relativePath) {
  const p = relativePath.toLowerCase();
  if (p.includes("/webhook")) return "webhook (likely provider-authenticated, not session-authenticated)";
  if (p.includes("/auth/") || p.includes("mfa")) return "auth/security (likely must stay reachable regardless of billing)";
  if (p.includes("privacy") || p.includes("export") || p.includes("recovery")) return "export/privacy/recovery (likely must stay reachable)";
  if (p.includes("/settings/")) return "platform administration (org/company/branch/role/billing settings, not tenant business data)";
  if (p.includes("reconciliation") || p.includes("accounting-post")) return "financial-record-keeping (needs case-by-case judgment)";
  return "business-data mutation (default assumption, needs confirmation)";
}

const routeFiles = walk(API_DIR).sort();
const rows = [];

for (const filePath of routeFiles) {
  const source = readFile(filePath);
  const methods = detectMethods(source);
  const mutationMethods = methods.filter((m) => MUTATION_METHODS.has(m));
  if (mutationMethods.length === 0) continue;

  const relativePath = filePath.replaceAll("\\", "/").replace(/^apps\/web\/src\/app\//, "");
  const billingGate = detectBillingGate(source);
  const isCrmOrPos = relativePath.startsWith("api/crm/") || relativePath.startsWith("api/pos/");
  const exclusionReason = DOCUMENTED_EXCLUSIONS[relativePath] ?? "";
  rows.push({
    route: relativePath,
    mutationMethods: mutationMethods.join(","),
    billingGate,
    // Only CRM/POS routes are in scope for this specific gate today (the
    // other 10 modules have no route layer at all -- see the tracker's
    // Section 9 finding); everything else is out of scope, not a gap.
    status: !isCrmOrPos ? "out-of-scope" : billingGate !== "none" ? "gated" : exclusionReason ? "excluded" : "UNACCOUNTED",
    exclusionReason,
    heuristicCategory: heuristicCategory(relativePath),
  });
}

function csvField(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
const header = ["route", "mutation_methods", "billing_gate", "status", "exclusion_reason", "heuristic_category"];
const lines = [header.join(",")];
for (const row of rows) {
  lines.push([row.route, row.mutationMethods, row.billingGate, row.status, row.exclusionReason, row.heuristicCategory].map(csvField).join(","));
}

const outPath = "docs/frontend-rebuild/BILLING_MUTATION_INVENTORY.csv";
fs.writeFileSync(outPath, lines.join("\n") + "\n");

const inScope = rows.filter((r) => r.status !== "out-of-scope");
const gated = inScope.filter((r) => r.status === "gated").length;
const excluded = inScope.filter((r) => r.status === "excluded").length;
const unaccounted = inScope.filter((r) => r.status === "UNACCOUNTED");
console.log(
  `Wrote ${rows.length} mutation-capable routes to ${outPath}. In scope (CRM/POS): ${inScope.length} -- ${gated} gated, ${excluded} documented-excluded, ${unaccounted.length} UNACCOUNTED.`,
);
if (unaccounted.length) {
  console.log("UNACCOUNTED routes (neither gated nor documented as excluded):");
  for (const row of unaccounted) console.log(`  - ${row.route}`);
}
