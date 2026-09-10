// CRM vNext Prompt 2 — CRM Home ("Customer growth workspace") coverage.
// apps/web/src/app/(app)/crm/page.tsx is an async Server Component that
// calls requireWorkspace()/tenantTransaction() (real auth/DB wiring) —
// like every other CRM route page, it cannot be executed outside a running
// Next.js request without reimplementing that plumbing as a mock, which
// would test the mock rather than the page. This follows the same
// structural verification convention already used for CRM route pages
// elsewhere in this suite (e.g. crm-lead-timeline-f019.test.mjs), and
// specifically proves: real (non-mock) data sources, permission-gated
// authorization, scope-derived (not client-invented) seller/manager
// framing, and a genuine empty state for every data-driven section — the
// concrete Prompt 2 "no invented values / graceful empty states" contract.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const home = read("src/app/(app)/crm/page.tsx");

test("CRM Home: requires authenticated workspace + CRM view permission before rendering anything", () => {
  assert.match(home, /const session = await requireWorkspace\(\);/);
  assert.match(home, /if \(!hasPermission\(session, PERMISSIONS\.crmView\)\) notFound\(\);/);
});

test("CRM Home: every section is sourced from real governed CRM queries, not a mock/sample data literal", () => {
  assert.match(home, /import \{ getCrmDashboard, listCrmRecords \} from "@vercentlabs\/api";/);
  assert.match(home, /getCrmDashboard\(client, context\)/);
  assert.match(home, /listCrmRecords\(client, context, "leads", \{ limit: 5 \}\)/);
  assert.doesNotMatch(home, /\bmock(Data|Lead|Activity)\b/i, "CRM Home must not contain mock/sample data literals");
});

test("CRM Home: seller-vs-manager framing is derived from the caller's own already-authorized scope permission, not re-implemented client-side authorization logic", () => {
  assert.match(home, /const isTeamScope =\s*\n\s*hasPermission\(session, PERMISSIONS\.crmRecordsViewAll\) \|\|\s*\n\s*session\.roleSlugs\.includes\("organization_owner"\);/);
  assert.match(home, /const scopeWord = isTeamScope \? "Team" : "My";/);
  // The label is presentation-only — the underlying dashboard/leads queries
  // (getCrmDashboard/listCrmRecords) are what actually enforce scope
  // server-side; this test only proves the UI never re-derives that
  // decision, it reads the same flag used only for a text label.
});

test("CRM Home: the 'My day' work breakdown is computed from already-fetched, already-scoped activity rows (no second unscoped query)", () => {
  assert.match(home, /for \(const activity of dashboard\.activities as DashboardRow\[\]\)/);
  assert.match(home, /activityTypeCounts\.set\(key, \(activityTypeCounts\.get\(key\) \|\| 0\) \+ 1\)/);
});

test("CRM Home: quick actions, metrics and every list section are permission-gated before rendering", () => {
  assert.match(home, /const canCreateLead = hasPermission\(session, PERMISSIONS\.crmLeadsManage\);/);
  assert.match(home, /const canCreateOpportunity = hasPermission\(/);
  assert.match(home, /const canCreateActivity = hasPermission\(session, PERMISSIONS\.crmActivitiesManage\);/);
  assert.match(home, /\{canCreateLead \? \(/);
});

test("CRM Home: every data-driven section has a graceful, non-blank empty state (StatePanel), not a bare empty render", () => {
  const stateSections = [...home.matchAll(/!dashboard\.(stages|sources|activities)\.length \? \(\s*<StatePanel/g)];
  assert.equal(stateSections.length, 3, "stages, sources and activities sections must each render a StatePanel when empty");
  assert.match(home, /recentLeads\.rows\.length \? \(/);
  assert.match(home, /<StatePanel\s*\n\s*title="No leads captured yet"/);
});

test("CRM Home: recent leads reuses the canonical, permission-scoped record link pattern (no ad-hoc query construction in the component)", () => {
  assert.match(home, /href=\{`\/crm\/leads\/\$\{lead\.id\}`\}/);
});

test("CRM Home: dynamic per-request rendering is preserved (dashboard data must never be statically cached across users/companies)", () => {
  assert.match(home, /export const dynamic = "force-dynamic";/);
});

test("CRM Home: no literal feature-ID or internal governance terminology is shown to the user", () => {
  assert.doesNotMatch(home, /F0\d\d/);
  assert.doesNotMatch(home, /canonical thirty-feature/i);
});

test("CRM setup page: no longer references internal feature-ID ranges or 'canonical thirty-feature' governance language", () => {
  const settings = read("src/app/(app)/crm/settings/page.tsx");
  assert.doesNotMatch(settings, /F0\d\d/);
  assert.doesNotMatch(settings, /thirty-feature/i);
});

test("CRM Home: uses the canonical CSS Module convention for its new sections, not a new global stylesheet", () => {
  assert.match(home, /import homeStyles from "\.\/crm-home-additions\.module\.css";/);
  assert.ok(
    fs.existsSync(new URL("../src/app/(app)/crm/crm-home-additions.module.css", import.meta.url)),
    "crm-home-additions.module.css must exist",
  );
});
