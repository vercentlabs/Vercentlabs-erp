import assert from "node:assert/strict";
import path from "node:path";
import { createHmac } from "node:crypto";

import dotenv from "dotenv";
import pg from "pg";

import {
  CRM_CONVERSATION_CAPABILITY_IDS,
  completeConversationTranscription,
  createTelephonyConnection,
  getConversationIntelligenceDashboard,
  getConversationIntelligenceTimeline,
  getCrmConversationReadiness,
  ingestTelephonyWebhook,
  issueRecordingAccessGrant,
  recordCrmConversationAcceptance,
  registerConversationRecording,
  requestConversationTranscription,
  startClickToCall,
  verifyTelephonyWebhookSignature,
} from "@vercentlabs/api";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });
const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
assert.ok(databaseUrl, "MIGRATION_DATABASE_URL or DATABASE_URL is required.");

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();
const unique = `CRM05-${Date.now()}`;

try {
  const migration = await client.query(
    "SELECT 1 FROM tenant_schema_migrations WHERE name=$1",
    ["032_crm_telephony_conversation_intelligence.sql"],
  );
  assert.ok(migration.rows[0], "CRM-05 tenant migration is not applied.");
  const baseline = (
    await client.query(
      `SELECT organization.id AS organization_id,organization.created_by AS user_id,company.id AS company_id
     FROM public.organizations organization
     JOIN public.companies company ON company.organization_id=organization.id
     WHERE organization.status='active' AND organization.created_by IS NOT NULL
     ORDER BY organization.created_at LIMIT 1`,
    )
  ).rows[0];
  assert.ok(
    baseline?.organization_id && baseline?.user_id && baseline?.company_id,
    "An active organisation, owner and company are required.",
  );

  await client.query("BEGIN");
  await client.query(
    "SELECT set_config('app.current_organization_id',$1,true)",
    [baseline.organization_id],
  );
  const context = {
    organizationId: baseline.organization_id,
    userId: baseline.user_id,
    activeCompanyId: baseline.company_id,
    activeBranchId: null,
    allowAllCompanies: true,
  };

  const connection = await createTelephonyConnection(client, context, {
    companyId: baseline.company_id,
    provider: "mock",
    displayName: `${unique} Mock telephony`,
    credentialReference: "env:CRM05_TEST_TELEPHONY_CREDENTIAL",
    webhookKey: `hook-${unique}`,
    defaultFromNumber: "+919876543210",
    recordingEnabled: true,
    transcriptionEnabled: true,
    requireRecordingConsent: true,
    retentionDays: 30,
    status: "connected",
  });
  assert.equal(connection.provider, "mock");

  await assert.rejects(
    () =>
      startClickToCall(client, context, {
        connectionId: connection.id,
        toNumber: "+919999999999",
        consentStatus: "unknown",
      }),
    /consent/i,
  );

  const conversation = await startClickToCall(client, context, {
    connectionId: connection.id,
    toNumber: "+919999999999",
    consentStatus: "granted",
    title: `${unique} Discovery call`,
    idempotencyKey: `${unique}-call`,
  });
  const repeated = await startClickToCall(client, context, {
    connectionId: connection.id,
    toNumber: "+919999999999",
    consentStatus: "granted",
    title: `${unique} duplicate request`,
    idempotencyKey: `${unique}-call`,
  });
  assert.equal(
    repeated.id,
    conversation.id,
    "Click-to-call must be idempotent.",
  );

  const rawBody = JSON.stringify({ id: `${unique}-event` });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = "crm05-live-secret";
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  assert.equal(
    verifyTelephonyWebhookSignature({ rawBody, timestamp, secret, signature }),
    true,
  );

  const eventResult = await ingestTelephonyWebhook(
    client,
    context,
    connection.id,
    "mock",
    {
      providerEventId: `${unique}-event`,
      providerCallId: `${unique}-provider-call`,
      eventType: "completed",
      direction: "inbound",
      fromNumber: "+919111111111",
      toNumber: "+919876543210",
      durationSeconds: 120,
      occurredAt: new Date().toISOString(),
    },
  );
  assert.equal(eventResult.duplicate, false);
  const duplicateEvent = await ingestTelephonyWebhook(
    client,
    context,
    connection.id,
    "mock",
    {
      providerEventId: `${unique}-event`,
      providerCallId: `${unique}-provider-call`,
      eventType: "completed",
      fromNumber: "+919111111111",
      toNumber: "+919876543210",
    },
  );
  assert.equal(
    duplicateEvent.duplicate,
    true,
    "Provider events must be idempotent.",
  );

  const recording = await registerConversationRecording(
    client,
    context,
    conversation.id,
    {
      provider: "mock",
      providerRecordingId: `${unique}-recording`,
      storageReference: `secret:recordings/${unique}`,
      mediaType: "audio/wav",
      durationSeconds: 180,
      byteSize: 4096,
      checksumSha256: "a".repeat(64),
      consentStatus: "granted",
      retentionUntil: new Date(Date.now() + 30 * 86400000).toISOString(),
    },
  );
  assert.equal(recording.status, "available");
  const grant = await issueRecordingAccessGrant(client, context, recording.id, {
    purpose: "quality review",
    expiresInMinutes: 5,
  });
  assert.ok(
    grant.token && grant.token_hash,
    "Recording access must return a one-time raw token and stored hash.",
  );
  assert.notEqual(grant.token, grant.token_hash);

  const job = await requestConversationTranscription(
    client,
    context,
    conversation.id,
    {
      provider: "mock",
      languageCode: "en-IN",
      idempotencyKey: `${unique}-transcription`,
    },
  );
  const repeatedJob = await requestConversationTranscription(
    client,
    context,
    conversation.id,
    {
      provider: "mock",
      languageCode: "en-IN",
      idempotencyKey: `${unique}-transcription`,
    },
  );
  assert.equal(
    repeatedJob.id,
    job.id,
    "Transcription requests must be idempotent.",
  );

  const transcript = await completeConversationTranscription(
    client,
    context,
    job.id,
    {
      languageCode: "en-IN",
      transcriptText:
        "Seller: We will send the proposal tomorrow. Customer: The budget is approved.",
      redactedText:
        "Seller: We will send the proposal tomorrow. Customer: The budget is approved.",
      confidence: 0.96,
      providerModel: "mock-diarization-v1",
      summary:
        "The buyer confirmed budget and the seller committed to sending a proposal.",
      segments: [
        {
          speakerLabel: "Seller",
          startedMs: 0,
          endedMs: 2500,
          text: "We will send the proposal tomorrow.",
          confidence: 0.97,
        },
        {
          speakerLabel: "Customer",
          startedMs: 2600,
          endedMs: 5000,
          text: "The budget is approved.",
          confidence: 0.95,
        },
      ],
      actionItems: [
        {
          title: "Send proposal",
          ownerUserId: baseline.user_id,
          dueAt: new Date(Date.now() + 86400000).toISOString(),
        },
      ],
      signals: [
        {
          type: "commitment",
          title: "Seller commitment",
          content: "Proposal tomorrow",
          score: 0.9,
        },
        {
          type: "sentiment",
          title: "Buyer sentiment",
          content: "Positive",
          score: 0.85,
        },
      ],
    },
  );
  assert.equal(transcript.status, "ready");

  const timeline = await getConversationIntelligenceTimeline(client, context, {
    conversationId: conversation.id,
  });
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].action_items.length, 1);
  assert.ok(timeline[0].insights.length >= 3);

  const dashboard = await getConversationIntelligenceDashboard(client, context);
  assert.ok(Number(dashboard.summary.recordings_available) >= 1);
  assert.ok(Number(dashboard.summary.transcripts_ready) >= 1);

  for (const capabilityId of CRM_CONVERSATION_CAPABILITY_IDS) {
    await recordCrmConversationAcceptance(client, context, {
      capabilityId,
      status: "passed",
      commitSha: process.env.RELEASE_SHA || "crm05-live",
      providerAcceptance: "sandbox",
      evidence: {
        connectionId: connection.id,
        conversationId: conversation.id,
        recordingId: recording.id,
        transcriptId: transcript.id,
        tenantIsolation: true,
        consentEnforced: true,
        idempotencyVerified: true,
      },
    });
  }
  const readiness = await getCrmConversationReadiness(client, context);
  assert.equal(readiness.readiness, "ready");
  assert.equal(readiness.score, 100);
  assert.equal(readiness.providerReadiness, "sandbox");

  await client.query("ROLLBACK");
  console.log(
    "CRM-05 telephony and conversation-intelligence live verification passed.",
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
