import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("F013 Web: Calls stay inside the focused Activities workspace", () => {
  const page = read("apps/web/src/app/(app)/crm/activities/page.tsx");
  assert.match(page, /activityType === "call"/);
  assert.match(page, /listCrmCalls/);
  assert.match(page, /CallsWorkspace/);
  assert.match(page, /crmDefinitions\.activities/);
});

test("F013 Web: dedicated Calls UI covers schedule, log, edit, dial, start, complete, cancel and immutable history", () => {
  const source = read("apps/web/src/modules/crm/components/calls-workspace.tsx");
  // "Immutable evidence" was customer-facing governance/engineering
  // terminology removed by CRM vNext Prompt 2 (§16) — the underlying
  // immutable call-history feature is unchanged and still covered by the
  // "Call history" assertion plus the append-only event log this
  // component renders (crm-calls-f013.test.mjs's API-level sibling tests
  // in services/api/tests/ cover the actual immutability guarantee).
  for (const phrase of ["Schedule Call", "Log completed Call", "Edit scheduled Call", "Dial", "Start", "Complete", "Cancel", "Call history"]) assert.match(source, new RegExp(phrase));
  assert.match(source, /\/api\/crm\/calls/);
  assert.match(source, /outcomeCode/);
  assert.match(source, /expectedUpdatedAt/);
  assert.match(source, /expectedStatus/);
});

test("F013 Web: Call creation uses real CRM relation selectors rather than raw UUID-only UX", () => {
  const source = read("apps/web/src/modules/crm/components/calls-workspace.tsx");
  for (const key of ["leads", "opportunities", "parties", "contacts", "campaigns"]) assert.match(source, new RegExp(key));
  assert.match(source, /Related record type/);
  assert.match(source, /Select record/);
});

test("F013 Web: API routes preserve permissions, billing, same-origin, transaction and PII-safe audit", () => {
  const routes = [
    "apps/web/src/app/api/crm/calls/route.ts",
    "apps/web/src/app/api/crm/calls/[id]/route.ts",
    "apps/web/src/app/api/crm/calls/[id]/start/route.ts",
    "apps/web/src/app/api/crm/calls/[id]/complete/route.ts",
    "apps/web/src/app/api/crm/calls/[id]/cancel/route.ts",
  ];
  for (const file of routes) {
    const source = read(file);
    assert.match(source, /crmApiContext/);
    assert.match(source, /tenantTransaction/);
  }
  for (const file of routes.slice(0, 1).concat(routes.slice(1))) {
    const source = read(file);
    if (!/export async function (POST|PATCH)/.test(source)) continue;
    assert.match(source, /requireBillingWriteAccess/);
    assert.match(source, /crmCallAuditSnapshot/);
  }
  assert.match(read(routes[0]), /assertSameOrigin/);
});

test("F013 Web: mobile APIs use durable idempotency and the shared SDK exposes all Call actions", () => {
  const mobileRoutes = [
    "apps/web/src/app/api/mobile/v1/crm/calls/route.ts",
    "apps/web/src/app/api/mobile/v1/crm/calls/[id]/start/route.ts",
    "apps/web/src/app/api/mobile/v1/crm/calls/[id]/complete/route.ts",
    "apps/web/src/app/api/mobile/v1/crm/calls/[id]/cancel/route.ts",
  ];
  for (const file of mobileRoutes) assert.match(read(file), /withMobileIdempotency/);
  const sdk = read("packages/shared-sdk/src/mobile.js");
  for (const method of ["createCall", "startCall", "completeCall", "cancelCall"]) assert.match(sdk, new RegExp(`${method}\\(`));
});

test("F013 Web: native mobile create/lifecycle and offline replay do not fall back to generic Call writes", () => {
  const create = read("apps/mobile/src/modules/crm/components/create-record-sheet.tsx");
  const detail = read("apps/mobile/src/app/(protected)/crm/[resource]/[id].tsx");
  const sync = read("apps/mobile/src/modules/crm/data/sync.ts");
  assert.match(create, /mobileApi\.createCall/);
  assert.match(create, /create-call/);
  assert.match(detail, /mobileApi\.startCall/);
  assert.match(detail, /mobileApi\.completeCall/);
  assert.match(detail, /mobileApi\.cancelCall/);
  for (const op of ["create-call", "start-call", "complete-call", "cancel-call"]) assert.match(sync, new RegExp(op));
});

test("F013 Web: responsive Call workspace is globally imported with mobile-safe controls", () => {
  const css = read("apps/web/src/app/crm-calls.css");
  const layout = read("apps/web/src/app/layout.tsx");
  assert.match(layout, /crm-calls\.css/);
  assert.match(css, /@media\(max-width:780px\)/);
  assert.match(css, /min-height:44px/);
  // The hand-rolled dialog backdrop's own prefers-reduced-motion rule was
  // removed with the backdrop itself (Prompt 6 CRM-VNEXT-072 migration onto
  // the shared Dialog primitive) — reduced-motion is now handled once, by
  // dialog.module.css, for every dialog including Calls'.
  const dialogCss = read("apps/web/src/shared/design/dialog.module.css");
  assert.match(dialogCss, /prefers-reduced-motion/);
});

test("F013 docs/register preserve the canonical Calls identity and verified production-ready status", () => {
  const spec = read("docs/03-modules/crm/features/F013-calls.md");
  const register = read("docs/02-register/FEATURE_REGISTER.csv");
  assert.match(spec, /Canonical ID: `F013`/);
  assert.match(spec, /Canonical name: \*\*Calls\*\*/);
  assert.match(spec, /Implementation status: `IMPLEMENTED`/);
  assert.match(spec, /Product status: `PRODUCTION_READY`/);
  assert.match(register, /^F013,CRM,Calls,SPECIFICATION_READY,IMPLEMENTED,PRODUCTION_READY,/m);
});

test("F013 Web: native mobile Call completion narrows optional outcome code before governed completion", () => {
  const detail = read("apps/mobile/src/app/(protected)/crm/[resource]/[id].tsx");
  assert.match(detail, /onPress=\{\(\) => \{ if \(code\) void completeCall\(code\); \}\}/);
  assert.doesNotMatch(detail, /onPress=\{\(\) => void completeCall\(code\)\}/);
  assert.doesNotMatch(detail, /completeCall\(code!\)/);
});
