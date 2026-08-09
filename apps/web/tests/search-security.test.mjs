import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// /api/search/route.ts transitively touches @/lib/auth, @/lib/db and the
// module-gated session helpers — unsafe to execute outside a real request/
// DB context (same precedent as every DB-touching route tested elsewhere
// in this suite). Verified by static source-pattern checks confirming it
// calls the SAME already-secured functions its own module's dedicated
// list route already calls, never new SQL.
const searchRouteSource = () => read("apps/web/src/app/api/search/route.ts");

test("search security: the orchestrator reuses each module's existing, already-secured session helper — never a raw session/context bypass", () => {
  const source = searchRouteSource();
  assert.match(source, /crmApiContext\(session\)/, "CRM adapter must use the module-gated crmApiContext(), inheriting Prompt 5's module-access check");
  assert.match(source, /await procurementSession\(\)/, "procurement adapter must use procurementSession(), inheriting Prompt 5's module-access check");
  assert.match(source, /await salesSession\(\)/, "sales adapter must use salesSession(), inheriting Prompt 5's module-access check");
  assert.match(source, /await accountingSession\(\)/, "accounting adapter must use accountingSession(), inheriting Prompt 5's module-access check");
  assert.match(source, /businessDataContext\(session\)/, "business-data adapter must use businessDataContext()");
});

test("search security: CRM adapter inherits Prompt 3's owner-scoping by calling the exact same listCrmRecords() the CRM list route uses, not a new query", () => {
  const source = searchRouteSource();
  assert.match(source, /listCrmRecords\(client, context, resource, \{ search: q/);
  assert.doesNotMatch(source, /FROM tenant\.crm_|SELECT .* FROM crm_/i, "must not contain hand-written CRM SQL — recordScope() owner-scoping only exists inside listCrmRecords()");
});

test("search security: procurement adapter inherits supplier banking-field redaction by calling listProcurementRecords(), which already applies applySupplierFieldVisibility() to every row", () => {
  const source = searchRouteSource();
  assert.match(source, /listProcurementRecords\(client, context, resource/);
  // The adapter's own mapping must never reference a banking/sensitive
  // field name directly — it can only be as safe as listProcurementRecords'
  // own redaction, and must not try to read a field that redaction removes.
  assert.doesNotMatch(source, /bankAccount|routingNumber|ifsc|accountNumber/i);
});

test("search security: no adapter writes raw SQL, string-interpolates the query, or bypasses parameterized queries — every adapter delegates to an existing service-layer function", () => {
  const source = searchRouteSource();
  assert.doesNotMatch(source, /client\.query\(/, "the search route must never call client.query() directly — only the reused service functions may touch SQL");
  assert.doesNotMatch(source, /\$\{q\}|\$\{query\}/, "query text must never be interpolated into anything (including a constructed string) — it only ever flows through as filters.search, which the reused functions already parameterize");
});

test("search security: results are capped — a per-adapter limit and a total result limit both exist", () => {
  const source = searchRouteSource();
  assert.match(source, /PER_ADAPTER_LIMIT = 5/);
  assert.match(source, /TOTAL_RESULT_LIMIT = 20/);
  assert.match(source, /results\.slice\(0, TOTAL_RESULT_LIMIT\)/);
});

test("search security: query length is bounded and a minimum length is enforced before any adapter runs", () => {
  const source = searchRouteSource();
  assert.match(source, /MAX_QUERY_LENGTH = 100/);
  assert.match(source, /MIN_QUERY_LENGTH = 2/);
  assert.match(source, /q\.length < MIN_QUERY_LENGTH/);
  assert.match(source, /rawQuery\.trim\(\)\.slice\(0, MAX_QUERY_LENGTH\)/);
});

test("search security: the endpoint requires an authenticated workspace session — it is not reachable without one", () => {
  const source = searchRouteSource();
  assert.match(source, /const session = await requireApiWorkspace\(\);/);
});

test("search security: rate-limited per authenticated user (not the public lead-capture endpoint's IP/fingerprint limiter, which would conflate every user behind the same office egress IP)", () => {
  const source = searchRouteSource();
  assert.match(source, /enforceRateLimit\(`search:\$\{session\.userId\}`, 60, 60\)/);
});

test("search security: a single adapter's failure (module disabled, DB error) cannot fail the whole response — Promise.allSettled, not Promise.all", () => {
  const source = searchRouteSource();
  assert.match(source, /Promise\.allSettled\(/);
  assert.doesNotMatch(source, /Promise\.all\(\s*adapters/);
});

test("search security: only modules confirmed to have real, existing search support are wired in (HR-payroll, stock, support, assets, projects, manufacturing, quality, point-of-sale list routes do not forward a search param and are correctly excluded)", () => {
  const source = searchRouteSource();
  for (const excluded of ["searchHrPayroll", "searchStock", "searchSupport", "searchAssets", "searchProjects", "searchManufacturing", "searchQuality", "searchPointOfSale"]) {
    assert.doesNotMatch(source, new RegExp(excluded), `${excluded} should not exist — no confirmed search-capable route backs it`);
  }
});

test("search security: mapped results never include a raw row — only an explicit allowlist of fields (label/description via safeLabel/safeDescription helpers)", () => {
  const source = searchRouteSource();
  assert.doesNotMatch(source, /\.\.\.row\b/, "must never spread a raw database row into a result");
  assert.match(source, /function safeLabel/);
  assert.match(source, /function safeDescription/);
});

test("Quick Create security: /crm/leads?create=1 etc. are gated by the same server-resolved permission set as the underlying create action, not merely hidden client-side", () => {
  const resolverSource = read("apps/web/src/lib/quick-create/resolve-quick-create.ts");
  assert.match(resolverSource, /accessibleModuleIds\.has\(action\.moduleId\)/);
  assert.match(resolverSource, /hasPermission\(session, action\.permission\)/);
  // Fail-closed on a lookup error, same contract as resolveNavigation.
  assert.match(resolverSource, /catch \{[\s\S]*?accessibleModuleIds = new Set\(\);/);
});
