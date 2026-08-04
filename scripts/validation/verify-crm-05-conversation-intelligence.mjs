import assert from "node:assert/strict";
import fs from "node:fs";

const requiredFiles = [
  "database/tenant/migrations/032_crm_telephony_conversation_intelligence.sql",
  "services/api/src/crm/conversation-intelligence.js",
  "services/api/src/crm/conversation-intelligence.d.ts",
  "services/api/tests/crm-conversation-intelligence-crm05.test.mjs",
  "apps/web/src/lib/crm-conversation-intelligence-route.ts",
  "apps/web/src/app/api/crm/conversation-intelligence/dashboard/route.ts",
  "apps/web/src/app/api/crm/conversation-intelligence/readiness/route.ts",
  "apps/web/src/app/api/crm/conversation-intelligence/connections/route.ts",
  "apps/web/src/app/api/crm/conversation-intelligence/calls/route.ts",
  "apps/web/src/app/api/crm/conversation-intelligence/timeline/route.ts",
  "apps/web/src/app/api/crm/conversation-intelligence/conversations/[id]/recordings/route.ts",
  "apps/web/src/app/api/crm/conversation-intelligence/conversations/[id]/transcriptions/route.ts",
  "apps/web/src/app/api/crm/conversation-intelligence/recordings/[id]/access/route.ts",
  "apps/web/src/app/api/crm/conversation-intelligence/transcriptions/[id]/complete/route.ts",
  "apps/web/src/app/api/crm/conversation-intelligence/webhooks/[provider]/route.ts",
  "apps/web/src/app/api/mobile/v1/crm/conversation-intelligence/route.ts",
  "apps/web/src/app/(app)/crm/conversation-intelligence/page.tsx",
  "apps/web/scripts/verify-crm-conversation-intelligence-live.mjs",
  "docs/implementation/stages/CRM_05_TELEPHONY_CONVERSATION_INTELLIGENCE.md",
];
for (const file of requiredFiles)
  assert.ok(fs.existsSync(file), `Missing CRM-05 file: ${file}`);

const migration = fs.readFileSync(requiredFiles[0], "utf8");
for (const table of [
  "crm_telephony_connections",
  "crm_telephony_commands",
  "crm_telephony_events",
  "crm_conversation_recordings",
  "crm_recording_access_grants",
  "crm_transcription_jobs",
  "crm_conversation_transcripts",
  "crm_transcript_segments",
  "crm_conversation_action_items",
  "crm_conversation_acceptance_runs",
])
  assert.match(
    migration,
    new RegExp(`CREATE TABLE IF NOT EXISTS tenant\\.${table}`),
  );
assert.match(migration, /FORCE ROW LEVEL SECURITY/);
assert.match(migration, /crm_public_telephony_connection/);
assert.match(migration, /crm_conversation_evidence_immutable/);
assert.match(migration, /provider_call_id/);

const service = fs.readFileSync(requiredFiles[1], "utf8");
for (const symbol of [
  "normalizePhoneNumber",
  "verifyTelephonyWebhookSignature",
  "normalizeTelephonyEvent",
  "telephonyTransitionAllowed",
  "buildConversationInsights",
  "createTelephonyConnection",
  "startClickToCall",
  "ingestTelephonyWebhook",
  "registerConversationRecording",
  "issueRecordingAccessGrant",
  "requestConversationTranscription",
  "completeConversationTranscription",
  "getConversationIntelligenceTimeline",
  "getConversationIntelligenceDashboard",
  "recordCrmConversationAcceptance",
  "getCrmConversationReadiness",
])
  assert.match(service, new RegExp(`export (async )?function ${symbol}`));
assert.match(service, /timingSafeEqual/);
assert.match(service, /CRM_RECORDING_CONSENT_REQUIRED/);
assert.match(service, /idempotencyKey/);
assert.match(service, /content_hash/);

const ids = ["CRM-003", "CRM-006", "CRM-046", "CRM-049"];
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
    `${id} lacks acceptance evidence.`,
  );
  assert.ok(
    row?.implementationPaths?.length >= 5,
    `${id} lacks implementation evidence.`,
  );
  assert.ok(row?.testPaths?.length >= 3, `${id} lacks test evidence.`);
}

const rootPackage = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.ok(rootPackage.scripts["verify:crm-05"]);
assert.ok(rootPackage.scripts["verify:crm-05-complete"]);
assert.ok(rootPackage.scripts["test:crm-05-live"]);
const webPackage = JSON.parse(fs.readFileSync("apps/web/package.json", "utf8"));
assert.ok(webPackage.scripts["crm:conversation-intelligence:live"]);
assert.match(
  fs.readFileSync("apps/web/src/components/app-shell.tsx", "utf8"),
  /\/crm\/conversation-intelligence/,
);
assert.match(
  fs.readFileSync("apps/mobile/src/core/modules/navigation.ts", "utf8"),
  /crm-conversation-intelligence/,
);
assert.match(
  fs.readFileSync("apps/mobile/src/core/modules/web-parity.ts", "utf8"),
  /\/crm\/conversation-intelligence/,
);

console.log(
  "CRM-05 telephony and conversation-intelligence contract verified.",
);
