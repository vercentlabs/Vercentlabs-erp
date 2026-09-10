import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

// Mobile/API parity closeout (F015-F019) — Prompt 10 owns mobile visual
// polish; this Prompt owns domain/security/API parity. Every route below
// must call the SAME canonical domain function its web counterpart calls
// (no raw SQL, no re-derived rule), and authenticate via
// requireMobileSession (Bearer token) like every other mobile/v1 route —
// not the web cookie-session helper.
const MOBILE_ROUTES = [
  { file: "apps/web/src/app/api/mobile/v1/crm/tasks/route.ts", mustCall: ["listCrmTasks", "createCrmTask"] },
  { file: "apps/web/src/app/api/mobile/v1/crm/tasks/[id]/route.ts", mustCall: ["getCrmTask", "listCrmTaskHistory", "updateCrmTask"] },
  { file: "apps/web/src/app/api/mobile/v1/crm/tasks/[id]/claim/route.ts", mustCall: ["claimCrmTask"] },
  { file: "apps/web/src/app/api/mobile/v1/crm/tasks/[id]/release/route.ts", mustCall: ["releaseCrmTask"] },
  { file: "apps/web/src/app/api/mobile/v1/crm/follow-ups/route.ts", mustCall: ["listCrmFollowUps", "createCrmFollowUp"] },
  { file: "apps/web/src/app/api/mobile/v1/crm/follow-ups/[id]/route.ts", mustCall: ["getCrmFollowUp", "updateCrmFollowUp", "listRemindersForActivity"] },
  { file: "apps/web/src/app/api/mobile/v1/crm/follow-ups/[id]/complete/route.ts", mustCall: ["completeCrmFollowUp"] },
  { file: "apps/web/src/app/api/mobile/v1/crm/notes/route.ts", mustCall: ["listCrmNotes", "createCrmNote"] },
  { file: "apps/web/src/app/api/mobile/v1/crm/notes/[noteId]/route.ts", mustCall: ["getCrmNote", "updateCrmNote", "archiveCrmNote"] },
  { file: "apps/web/src/app/api/mobile/v1/crm/attachments/route.ts", mustCall: ["listCrmAttachments", "createCrmAttachment"] },
  { file: "apps/web/src/app/api/mobile/v1/crm/attachments/[attachmentId]/route.ts", mustCall: ["getCrmAttachmentContent", "deleteCrmAttachment"] },
  { file: "apps/web/src/app/api/mobile/v1/crm/timeline/route.ts", mustCall: ["getCrmRecordTimelinePage"] },
  { file: "apps/web/src/app/api/mobile/v1/crm/communications/route.ts", mustCall: ["getCommunicationsDashboard"] },
  { file: "apps/web/src/app/api/mobile/v1/crm/communications/threads/[id]/messages/route.ts", mustCall: ["listThreadMessages"] },
  { file: "apps/web/src/app/api/mobile/v1/crm/communications/threads/[id]/claim/route.ts", mustCall: ["claimSharedInboxThread"] },
  { file: "apps/web/src/app/api/mobile/v1/crm/communications/threads/[id]/status/route.ts", mustCall: ["updateSharedInboxThreadStatus"] },
  { file: "apps/web/src/app/api/mobile/v1/crm/communications/send/route.ts", mustCall: ["queueOutboundEmail"] },
];

for (const route of MOBILE_ROUTES) {
  test(`Mobile parity: ${route.file} calls the canonical domain function(s) [${route.mustCall.join(", ")}] and authenticates via requireMobileSession, not a raw query or the web cookie session`, () => {
    const source = read(route.file);
    for (const fn of route.mustCall) {
      assert.match(source, new RegExp(fn), `expected ${route.file} to call ${fn}`);
    }
    assert.match(source, /requireMobileSession\(request\)/, `expected ${route.file} to authenticate via the Bearer-token mobile session, not getSessionContext`);
    assert.doesNotMatch(source, /=\s*await getSessionContext\(\)/, `${route.file} must not use the web cookie-session helper`);
    assert.doesNotMatch(source, /SELECT .* FROM tenant\.crm_/i, `${route.file} must not embed raw SQL — it must delegate to the canonical domain module`);
  });
}

test("Mobile parity: Timeline route accepts all four canonical entity types (lead/opportunity/party/contact), matching web's own Timeline coverage — no mobile-only subset", () => {
  const source = read("apps/web/src/app/api/mobile/v1/crm/timeline/route.ts");
  for (const entityType of ["lead", "opportunity", "party", "contact"]) {
    assert.match(source, new RegExp(entityType));
  }
});

test("Mobile parity: Notes/Attachments mobile routes are entity-type-scoped (lead/opportunity/party/contact/campaign) — one canonical route per concept, not duplicated per entity", () => {
  for (const file of ["apps/web/src/app/api/mobile/v1/crm/notes/route.ts", "apps/web/src/app/api/mobile/v1/crm/attachments/route.ts"]) {
    const source = read(file);
    assert.match(source, /ENTITY_TYPES = new Set\(\["lead", "opportunity", "party", "contact", "campaign"\]\)/);
  }
});

test("Mobile parity: attachment download/delete never surfaces a storage_key or a redirect to an unauthenticated URL — bytes are streamed by this one authenticated route or not at all", () => {
  const source = read("apps/web/src/app/api/mobile/v1/crm/attachments/[attachmentId]/route.ts");
  assert.doesNotMatch(source, /Response\.redirect/);
  assert.doesNotMatch(source, /storage_key/);
  assert.match(source, /Cache-Control["']?:\s*["']private, no-store["']/);
});

test("Mobile parity: Follow-up completion has its OWN dedicated mobile route (completeCrmFollowUp), not silently missing behind the generic activities/[id]/complete route which calls a different function (completeCrmActivity)", () => {
  const followUpComplete = read("apps/web/src/app/api/mobile/v1/crm/follow-ups/[id]/complete/route.ts");
  const genericComplete = read("apps/web/src/app/api/mobile/v1/crm/activities/[id]/complete/route.ts");
  assert.match(followUpComplete, /completeCrmFollowUp/);
  assert.doesNotMatch(genericComplete, /completeCrmFollowUp/, "the generic activities complete route calls completeCrmActivity, a DIFFERENT function — Follow-up completion needed its own route, confirming this was a real gap, not already covered");
});

test("Mobile parity: the communications dashboard route was fixed to authenticate via requireMobileSession — it previously used the web cookie-session helper, a real inconsistency with every other mobile/v1 route", () => {
  const source = read("apps/web/src/app/api/mobile/v1/crm/communications/route.ts");
  assert.match(source, /requireMobileSession\(request\)/);
  assert.doesNotMatch(source, /=\s*await getSessionContext\(\)/);
});

test("Mobile parity: thread claim/status/messages routes require the SAME crmCommunicationsManage permission as web, inheriting the shared-inbox membership gate (assertSharedInboxMember) from the domain functions themselves", () => {
  for (const file of [
    "apps/web/src/app/api/mobile/v1/crm/communications/threads/[id]/messages/route.ts",
    "apps/web/src/app/api/mobile/v1/crm/communications/threads/[id]/claim/route.ts",
    "apps/web/src/app/api/mobile/v1/crm/communications/threads/[id]/status/route.ts",
  ]) {
    const source = read(file);
    assert.match(source, /PERMISSIONS\.crmCommunicationsManage/);
  }
});
