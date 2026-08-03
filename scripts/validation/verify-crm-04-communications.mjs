import assert from "node:assert/strict";
import fs from "node:fs";

const requiredFiles = [
  "database/tenant/migrations/031_crm_communications_calendar.sql",
  "services/api/src/crm/communications.js",
  "services/api/src/crm/communications.d.ts",
  "services/api/tests/crm-communications-crm04.test.mjs",
  "apps/web/src/lib/crm-communications-route.ts",
  "apps/web/src/app/api/crm/communications/dashboard/route.ts",
  "apps/web/src/app/api/crm/communications/readiness/route.ts",
  "apps/web/src/app/api/crm/communications/inbox/route.ts",
  "apps/web/src/app/api/crm/communications/inbox/[id]/claim/route.ts",
  "apps/web/src/app/api/crm/communications/inbox/[id]/members/route.ts",
  "apps/web/src/app/api/crm/communications/signatures/route.ts",
  "apps/web/src/app/api/crm/communications/send/route.ts",
  "apps/web/src/app/api/crm/communications/sync/route.ts",
  "apps/web/src/app/api/crm/communications/engagement/route.ts",
  "apps/web/src/app/api/crm/communications/timeline/route.ts",
  "apps/web/src/app/api/crm/communications/oauth/state/route.ts",
  "apps/web/src/app/api/crm/communications/webhooks/[provider]/route.ts",
  "apps/web/src/app/api/crm/public/meetings/[token]/availability/route.ts",
  "apps/web/src/app/api/crm/public/meetings/[token]/bookings/route.ts",
  "apps/web/src/app/api/crm/public/meetings/bookings/[token]/route.ts",
  "apps/web/src/app/api/mobile/v1/crm/communications/route.ts",
  "apps/web/src/app/(app)/crm/communications/page.tsx",
  "apps/web/scripts/verify-crm-communications-live.mjs",
  "docs/implementation/stages/CRM_04_COMMUNICATIONS_CALENDAR.md",
];
for (const file of requiredFiles) {
  assert.ok(fs.existsSync(file), `Missing CRM-04 file: ${file}`);
}

const migration = fs.readFileSync(requiredFiles[0], "utf8");
for (const table of [
  "crm_provider_oauth_states",
  "crm_shared_inboxes",
  "crm_shared_inbox_members",
  "crm_email_threads",
  "crm_email_messages",
  "crm_email_events",
  "crm_email_suppressions",
  "crm_email_signatures",
  "crm_calendar_events",
  "crm_calendar_attendees",
  "crm_meeting_bookings",
  "crm_provider_sync_jobs",
  "crm_communication_acceptance_runs",
]) {
  assert.match(
    migration,
    new RegExp(`CREATE TABLE IF NOT EXISTS tenant\\.${table}`),
  );
}
assert.match(migration, /FORCE ROW LEVEL SECURITY/);
assert.match(migration, /crm_public_meeting_link/);
assert.match(migration, /crm_public_meeting_booking/);
assert.match(migration, /crm_public_sync_account/);
assert.match(migration, /crm_communication_immutable_row/);

const service = fs.readFileSync(requiredFiles[1], "utf8");
for (const symbol of [
  "normalizeProviderMessage",
  "normalizeProviderCalendarEvent",
  "verifyCrmProviderWebhookSignature",
  "calculateMeetingSlots",
  "createProviderOAuthState",
  "consumeProviderOAuthState",
  "createSharedInbox",
  "upsertSharedInboxMember",
  "upsertEmailSignature",
  "listEmailSignatures",
  "fetchProviderMailboxDelta",
  "fetchProviderCalendarDelta",
  "synchronizeProviderAccount",
  "ingestMailboxDelta",
  "ingestCalendarDelta",
  "claimSharedInboxThread",
  "recordEmailEngagementEvent",
  "queueOutboundEmail",
  "getMeetingAvailability",
  "bookMeeting",
  "cancelMeetingBooking",
  "rescheduleMeetingBooking",
  "getCommunicationTimeline",
  "getCommunicationsDashboard",
  "recordCrmCommunicationsAcceptance",
  "getCrmCommunicationsReadiness",
]) {
  assert.match(service, new RegExp(`export (async )?function ${symbol}`));
}
assert.match(service, /gmail\.googleapis\.com/);
assert.match(service, /graph\.microsoft\.com/);
assert.match(service, /sync_lock_until/);
assert.match(service, /outside_send_window/);
assert.match(service, /CRM_INBOX_COLLISION/);
assert.match(service, /renderCommunicationTemplate/);
assert.match(service, /CRM_EMAIL_TEMPLATE_NOT_FOUND/);

const ids = [
  "CRM-001",
  "CRM-002",
  "CRM-004",
  "CRM-005",
  "CRM-036",
  "CRM-038",
  "CRM-040",
  "CRM-045",
  "CRM-081",
];
const evidence = JSON.parse(
  fs.readFileSync(
    "docs/implementation/four-module-feature-evidence.json",
    "utf8",
  ),
);
for (const id of ids) {
  const row = evidence.find((entry) => entry.id === id);
  assert.equal(row?.registerStatus, "Implemented", `${id} is not implemented.`);
  assert.equal(
    row?.acceptanceStatus,
    "verified",
    `${id} lacks executable acceptance evidence.`,
  );
  assert.ok(
    row?.implementationPaths?.length >= 5,
    `${id} lacks code evidence.`,
  );
  assert.ok(row?.testPaths?.length >= 3, `${id} lacks test evidence.`);
}

const rootPackage = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.ok(rootPackage.scripts["verify:crm-04"]);
assert.ok(rootPackage.scripts["verify:crm-04-complete"]);
assert.ok(rootPackage.scripts["test:crm-04-live"]);
const webPackage = JSON.parse(fs.readFileSync("apps/web/package.json", "utf8"));
assert.ok(webPackage.scripts["crm:communications:live"]);

const appShell = fs.readFileSync(
  "apps/web/src/components/app-shell.tsx",
  "utf8",
);
assert.match(appShell, /\/crm\/communications/);
const mobileNavigation = fs.readFileSync(
  "apps/mobile/src/core/modules/navigation.ts",
  "utf8",
);
assert.match(mobileNavigation, /crm-communications/);
const parity = fs.readFileSync(
  "apps/mobile/src/core/modules/web-parity.ts",
  "utf8",
);
assert.match(parity, /\/crm\/communications/);

console.log("CRM-04 communications and calendar contract verified.");
