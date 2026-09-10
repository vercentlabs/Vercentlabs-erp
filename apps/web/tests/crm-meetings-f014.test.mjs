import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.." );
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("F014 Web: Meetings stay inside the focused Activities workspace", () => {
  const page = read("apps/web/src/modules/crm/seller-activity-and-follow-up-workspace/activity-workspace-page.tsx");
  assert.match(page, /activityType === "meeting"/);
  assert.match(page, /listCrmMeetings/);
  assert.match(page, /MeetingsWorkspace/);
  assert.match(page, /activityType === "call"[\s\S]*CallsWorkspace/);
});

test("F014 Web: dedicated Meeting UX covers schedule, log, edit, join, start, complete, cancel and immutable history", () => {
  const source = read("apps/web/src/modules/crm/seller-activity-and-follow-up-workspace/meetings-workspace.tsx");
  // "Immutable evidence" was a customer-inappropriate internal-governance
  // label — dropped in Prompt 6 to match Calls' precedent (see
  // dialog-experience-kernel.test.mjs); the history dialog itself is
  // unchanged, just its subtitle text.
  for (const phrase of ["Schedule Meeting", "Log completed Meeting", "Edit scheduled Meeting", "Join", "Start", "Complete", "Cancel", "Meeting history"])
    assert.match(source, new RegExp(phrase));
  assert.match(source, /\/api\/crm\/meetings/);
  assert.match(source, /expectedUpdatedAt/);
  assert.match(source, /expectedStatus/);
  assert.match(source, /outcomeCode/);
});

test("F014 Web: Meeting editor uses real CRM relation and Contact attendee selectors", () => {
  const source = read("apps/web/src/modules/crm/seller-activity-and-follow-up-workspace/meetings-workspace.tsx");
  for (const key of ["leads", "opportunities", "parties", "contacts", "campaigns"]) assert.match(source, new RegExp(key));
  assert.match(source, /CRM Contact attendees/);
  assert.match(source, /Additional guest emails/);
  assert.match(source, /filter\(\(value\): value is string => Boolean\(value\)\)/);
});

test("F014 Web: dedicated routes preserve origin, permission, billing, transaction and PII-safe audit", () => {
  const routes = [
    "apps/web/src/app/api/crm/meetings/route.ts",
    "apps/web/src/app/api/crm/meetings/[id]/route.ts",
    "apps/web/src/app/api/crm/meetings/[id]/start/route.ts",
    "apps/web/src/app/api/crm/meetings/[id]/complete/route.ts",
    "apps/web/src/app/api/crm/meetings/[id]/cancel/route.ts",
  ];
  for (const file of routes) {
    const source = read(file);
    assert.match(source, /crmApiContext/);
    assert.match(source, /tenantTransaction/);
    if (/export async function (POST|PATCH)/.test(source)) {
      assert.match(source, /assertSameOrigin/);
      assert.match(source, /crmActivitiesManage/);
      assert.match(source, /requireBillingWriteAccess/);
      assert.match(source, /incrementBillingUsage/);
      assert.match(source, /crmMeetingAuditSnapshot/);
    }
  }
});

test("F014 mobile: dedicated endpoints use durable idempotency and shared SDK exposes Meeting lifecycle", () => {
  const routeFiles = [
    "apps/web/src/app/api/mobile/v1/crm/meetings/route.ts",
    "apps/web/src/app/api/mobile/v1/crm/meetings/[id]/start/route.ts",
    "apps/web/src/app/api/mobile/v1/crm/meetings/[id]/complete/route.ts",
    "apps/web/src/app/api/mobile/v1/crm/meetings/[id]/cancel/route.ts",
  ];
  for (const file of routeFiles) {
    const source = read(file);
    assert.match(source, /withMobileIdempotency/);
    assert.match(source, /crmActivitiesManage/);
  }
  const sdk = read("packages/shared-sdk/src/mobile.js");
  for (const method of ["createMeeting", "startMeeting", "completeMeeting", "cancelMeeting"]) assert.match(sdk, new RegExp(method));
});

test("F014 native mobile creation/lifecycle and offline replay never fall back to generic Meeting writes", () => {
  const create = read("apps/mobile/src/modules/crm/components/create-record-sheet.tsx");
  const detail = read("apps/mobile/src/app/(protected)/crm/[resource]/[id].tsx");
  const sync = read("apps/mobile/src/modules/crm/data/sync.ts");
  assert.match(create, /isMeeting/);
  assert.match(create, /mobileApi\.createMeeting/);
  assert.match(create, /create-meeting/);
  assert.match(detail, /mobileApi\.startMeeting/);
  assert.match(detail, /mobileApi\.completeMeeting/);
  assert.match(detail, /mobileApi\.cancelMeeting/);
  for (const operation of ["create-meeting", "start-meeting", "complete-meeting", "cancel-meeting"]) assert.match(sync, new RegExp(operation));
});

test("F014 responsive Meeting workspace consumes the canonical CRM presentation layer", () => {
  const layout = read("apps/web/src/app/(app)/crm/layout.tsx");
  const css = read("apps/web/src/modules/crm/ui/crm.css");
  assert.match(layout, /@\/modules\/crm\/ui\/crm\.css/);
  assert.match(css, /crm-meetings-filters[\s\S]*min-height:44px/);
  assert.match(css, /@media \(max-width: 1023px\)/);
  // The hand-rolled dialog backdrop's own prefers-reduced-motion rule was
  // removed with the backdrop itself (Prompt 6 CRM-VNEXT-072 migration onto
  // the shared Dialog primitive) — reduced-motion is now handled once, by
  // dialog.module.css, for every dialog including Meetings'.
  const dialogCss = read("apps/web/src/shared/design/dialog.module.css");
  assert.match(dialogCss, /prefers-reduced-motion/);
});

test("F014 docs/register preserve the canonical Meetings identity and verified production-ready status", () => {
  const spec = read("docs/03-modules/crm/features/F014-meetings.md");
  const register = read("docs/02-register/FEATURE_REGISTER.csv");
  assert.match(spec, /Canonical ID: `F014`/);
  assert.match(spec, /Canonical name: \*\*Meetings\*\*/);
  assert.match(spec, /Implementation status: `IMPLEMENTED`/);
  assert.match(spec, /Product status: `PRODUCTION_READY`/);
  assert.match(register, /^F014,CRM,Meetings,SPECIFICATION_READY,IMPLEMENTED,PRODUCTION_READY,/m);
  assert.match(register, /^F013,CRM,Calls,SPECIFICATION_READY,IMPLEMENTED,PRODUCTION_READY,/m);
});

test("F014 regression: F013 Calls remain governed and historical evidence does not pin CURRENT_FEATURE", () => {
  const page = read("apps/web/src/modules/crm/seller-activity-and-follow-up-workspace/activity-workspace-page.tsx");
  const callTest = read("apps/web/tests/crm-calls-f013.test.mjs");
  assert.match(page, /listCrmCalls/);
  assert.match(page, /CallsWorkspace/);
  assert.doesNotMatch(callTest, /CURRENT_FEATURE\.md/);
});
