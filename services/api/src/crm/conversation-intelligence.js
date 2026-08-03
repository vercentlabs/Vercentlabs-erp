import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHONE = /^\+[1-9]\d{7,14}$/;

export const CRM_CONVERSATION_CAPABILITY_IDS = Object.freeze([
  "CRM-003",
  "CRM-006",
  "CRM-046",
  "CRM-049",
]);

export class CrmConversationIntelligenceError extends Error {
  constructor(status, message, code = "CRM_CONVERSATION_INTELLIGENCE_ERROR") {
    super(message);
    this.name = "CrmConversationIntelligenceError";
    this.status = status;
    this.code = code;
  }
}

const text = (value) => String(value ?? "").trim();
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = (value) => (Array.isArray(value) ? value : []);
const integer = (value, fallback = 0) =>
  Number.isInteger(Number(value)) ? Number(value) : fallback;

function assertId(value, label) {
  const result = text(value);
  if (!UUID.test(result))
    throw new CrmConversationIntelligenceError(
      400,
      `${label} is invalid.`,
      "CRM_IDENTIFIER_INVALID",
    );
  return result;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function crmConversationHash(value) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export function normalizePhoneNumber(value, defaultCountryCode = "+91") {
  let result = text(value).replace(/[()\s.-]/g, "");
  if (!result.startsWith("+")) {
    result = result.startsWith("0") ? result.slice(1) : result;
    result = `${defaultCountryCode}${result}`;
  }
  if (!PHONE.test(result))
    throw new CrmConversationIntelligenceError(
      400,
      "Phone number must be E.164 compatible.",
      "CRM_PHONE_INVALID",
    );
  return result;
}

export function verifyTelephonyWebhookSignature(input = {}) {
  const rawBody = text(input.rawBody);
  const timestamp = text(input.timestamp);
  const signature = text(input.signature).replace(/^sha256=/i, "");
  const secret = text(input.secret);
  const toleranceSeconds = Math.max(30, integer(input.toleranceSeconds, 300));
  if (!rawBody || !timestamp || !signature || !secret) return false;
  const timestampMs =
    Number(timestamp) > 1e12 ? Number(timestamp) : Number(timestamp) * 1000;
  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(Date.now() - timestampMs) > toleranceSeconds * 1000
  )
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  try {
    return timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
}

export function normalizeTelephonyEvent(providerValue, inputValue = {}) {
  const provider = text(providerValue).toLowerCase();
  const input = object(inputValue);
  const eventType = text(
    input.eventType || input.event_type || input.CallStatus || input.status,
  ).toLowerCase();
  const map = {
    initiated: "initiated",
    queued: "initiated",
    ringing: "ringing",
    answered: "answered",
    "in-progress": "answered",
    in_progress: "answered",
    completed: "completed",
    ended: "completed",
    busy: "failed",
    failed: "failed",
    "no-answer": "failed",
    no_answer: "failed",
    recording: "recording_available",
    recording_available: "recording_available",
  };
  const occurredAt = new Date(
    input.occurredAt || input.occurred_at || input.Timestamp || Date.now(),
  ).toISOString();
  return {
    provider,
    providerEventId: text(
      input.providerEventId ||
        input.provider_event_id ||
        input.EventSid ||
        input.id ||
        crmConversationHash(input),
    ),
    providerCallId: text(
      input.providerCallId ||
        input.provider_call_id ||
        input.CallSid ||
        input.call_id,
    ),
    eventType: map[eventType] || eventType || "unknown",
    direction: text(
      input.direction || input.Direction || "outbound",
    ).toLowerCase(),
    fromNumber: normalizePhoneNumber(
      input.fromNumber || input.from_number || input.From || "+910000000000",
    ),
    toNumber: normalizePhoneNumber(
      input.toNumber || input.to_number || input.To || "+910000000001",
    ),
    occurredAt,
    durationSeconds: Math.max(
      0,
      integer(
        input.durationSeconds || input.duration_seconds || input.CallDuration,
        0,
      ),
    ),
    recordingId:
      text(input.recordingId || input.recording_id || input.RecordingSid) ||
      null,
    recordingReference:
      text(
        input.recordingReference ||
          input.recording_reference ||
          input.RecordingUrl,
      ) || null,
    payload: input,
  };
}

export function telephonyTransitionAllowed(fromStatus, eventType) {
  const allowed = {
    scheduled: new Set([
      "initiated",
      "ringing",
      "answered",
      "failed",
      "completed",
    ]),
    in_progress: new Set([
      "ringing",
      "answered",
      "completed",
      "failed",
      "recording_available",
    ]),
    completed: new Set(["recording_available"]),
    failed: new Set(["recording_available"]),
    cancelled: new Set(),
    archived: new Set(),
  };
  return (allowed[text(fromStatus)] || new Set()).has(text(eventType));
}

export function buildConversationInsights(input = {}) {
  const transcript = text(input.transcript);
  const summary =
    text(input.summary) ||
    transcript
      .split(/(?<=[.!?])\s+/)
      .slice(0, 3)
      .join(" ");
  const actionItems = array(input.actionItems)
    .map((item) => ({
      title: text(item.title || item),
      description: text(item.description) || null,
      ownerUserId: text(item.ownerUserId) || null,
      dueAt: item.dueAt ? new Date(item.dueAt).toISOString() : null,
      evidence: array(item.evidence),
    }))
    .filter((item) => item.title);
  const signals = array(input.signals)
    .map((signal) => ({
      type: text(signal.type || "topic"),
      title: text(signal.title || signal.type || "Conversation signal"),
      content: text(signal.content || signal.value),
      score: signal.score == null ? null : Number(signal.score),
      evidence: array(signal.evidence),
    }))
    .filter((signal) => signal.content);
  return { summary, actionItems, signals };
}

export async function createTelephonyConnection(client, context, input = {}) {
  const provider = text(input.provider).toLowerCase();
  if (!["twilio", "exotel", "plivo", "mock", "custom"].includes(provider)) {
    throw new CrmConversationIntelligenceError(
      400,
      "Unsupported telephony provider.",
      "CRM_TELEPHONY_PROVIDER_INVALID",
    );
  }
  const credentialReference = text(input.credentialReference);
  if (
    !credentialReference ||
    !/^(env|vault|secret):/.test(credentialReference)
  ) {
    throw new CrmConversationIntelligenceError(
      400,
      "Use an env:, vault: or secret: credential reference.",
      "CRM_CREDENTIAL_REFERENCE_INVALID",
    );
  }
  const webhookKey = text(input.webhookKey) || randomBytes(24).toString("hex");
  const result = await client.query(
    `INSERT INTO tenant.crm_telephony_connections(
       organization_id,company_id,provider,display_name,credential_reference,webhook_key,
       default_from_number,recording_enabled,transcription_enabled,require_recording_consent,
       retention_days,status,metadata,created_by,updated_by
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)
     RETURNING *`,
    [
      context.organizationId,
      input.companyId || context.activeCompanyId || null,
      provider,
      text(input.displayName) || `${provider} telephony`,
      credentialReference,
      webhookKey,
      input.defaultFromNumber
        ? normalizePhoneNumber(input.defaultFromNumber)
        : null,
      Boolean(input.recordingEnabled),
      Boolean(input.transcriptionEnabled),
      input.requireRecordingConsent !== false,
      Math.min(3650, Math.max(1, integer(input.retentionDays, 90))),
      text(input.status) || "connected",
      JSON.stringify(object(input.metadata)),
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function startClickToCall(client, context, input = {}) {
  const connectionId = assertId(input.connectionId, "Telephony connection");
  const connection = (
    await client.query(
      `SELECT * FROM tenant.crm_telephony_connections WHERE organization_id=$1 AND id=$2 AND status='connected'`,
      [context.organizationId, connectionId],
    )
  ).rows[0];
  if (!connection)
    throw new CrmConversationIntelligenceError(
      404,
      "Connected telephony provider not found.",
      "CRM_TELEPHONY_CONNECTION_NOT_FOUND",
    );
  const fromNumber = normalizePhoneNumber(
    input.fromNumber || connection.default_from_number,
  );
  const toNumber = normalizePhoneNumber(input.toNumber);
  const consentStatus = text(input.consentStatus) || "unknown";
  if (
    connection.recording_enabled &&
    connection.require_recording_consent &&
    consentStatus !== "granted"
  ) {
    throw new CrmConversationIntelligenceError(
      409,
      "Recording consent must be granted before starting this call.",
      "CRM_RECORDING_CONSENT_REQUIRED",
    );
  }
  const idempotencyKey =
    text(input.idempotencyKey) ||
    crmConversationHash({
      connectionId,
      fromNumber,
      toNumber,
      owner: context.userId,
      minute: new Date().toISOString().slice(0, 16),
    });
  const existing = (
    await client.query(
      `SELECT conversation.* FROM tenant.crm_telephony_commands command
     JOIN tenant.crm_conversations conversation ON conversation.organization_id=command.organization_id AND conversation.id=command.conversation_id
     WHERE command.organization_id=$1 AND command.idempotency_key=$2`,
      [context.organizationId, idempotencyKey],
    )
  ).rows[0];
  if (existing) return existing;
  const conversation = (
    await client.query(
      `INSERT INTO tenant.crm_conversations(
       organization_id,company_id,lead_id,opportunity_id,party_id,contact_id,channel,provider,title,
       started_at,transcript_status,consent_status,retention_until,status,created_by,updated_by,
       direction,owner_user_id,from_number,to_number,recording_status,metadata
     ) VALUES($1,$2,$3,$4,$5,$6,'call',$7,$8,now(),'not_requested',$9,
       now()+make_interval(days=>$10),'scheduled',$11,$11,'outbound',$11,$12,$13,$14,$15)
     RETURNING *`,
      [
        context.organizationId,
        input.companyId || context.activeCompanyId || null,
        input.leadId || null,
        input.opportunityId || null,
        input.partyId || null,
        input.contactId || null,
        connection.provider,
        text(input.title) || `Call to ${toNumber}`,
        consentStatus,
        Number(connection.retention_days),
        context.userId,
        fromNumber,
        toNumber,
        connection.recording_enabled ? "pending" : "not_available",
        JSON.stringify({
          connectionId,
          clickToCall: true,
          userMetadata: object(input.metadata),
        }),
      ],
    )
  ).rows[0];
  await client.query(
    `INSERT INTO tenant.crm_telephony_commands(
       organization_id,connection_id,conversation_id,command_type,idempotency_key,payload
     ) VALUES($1,$2,$3,'start_call',$4,$5)`,
    [
      context.organizationId,
      connectionId,
      conversation.id,
      idempotencyKey,
      JSON.stringify({
        fromNumber,
        toNumber,
        callbackKey: connection.webhook_key,
      }),
    ],
  );
  return conversation;
}

export async function ingestTelephonyWebhook(
  client,
  context,
  connectionIdValue,
  providerValue,
  input = {},
) {
  const connectionId = assertId(connectionIdValue, "Telephony connection");
  const normalized = normalizeTelephonyEvent(providerValue, input);
  const inserted = await client.query(
    `INSERT INTO tenant.crm_telephony_events(
       organization_id,connection_id,provider,provider_event_id,event_type,occurred_at,payload,payload_hash
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (organization_id,provider,provider_event_id) DO NOTHING RETURNING *`,
    [
      context.organizationId,
      connectionId,
      normalized.provider,
      normalized.providerEventId,
      normalized.eventType,
      normalized.occurredAt,
      JSON.stringify(normalized.payload),
      crmConversationHash(normalized.payload),
    ],
  );
  if (!inserted.rows[0]) return { duplicate: true };
  let conversation = (
    await client.query(
      `SELECT * FROM tenant.crm_conversations WHERE organization_id=$1 AND provider=$2 AND provider_call_id=$3 LIMIT 1`,
      [context.organizationId, normalized.provider, normalized.providerCallId],
    )
  ).rows[0];
  if (!conversation) {
    conversation = (
      await client.query(
        `INSERT INTO tenant.crm_conversations(
         organization_id,channel,provider,external_id,provider_call_id,title,started_at,status,created_by,updated_by,
         direction,owner_user_id,from_number,to_number,recording_status,metadata
       ) VALUES($1,'call',$2,$3,$3,$4,$5,$6,$7,$7,$8,$7,$9,$10,'not_available',$11) RETURNING *`,
        [
          context.organizationId,
          normalized.provider,
          normalized.providerCallId,
          `Call ${normalized.fromNumber} → ${normalized.toNumber}`,
          normalized.occurredAt,
          normalized.eventType === "completed"
            ? "completed"
            : normalized.eventType === "failed"
              ? "failed"
              : "in_progress",
          context.userId,
          normalized.direction,
          normalized.fromNumber,
          normalized.toNumber,
          JSON.stringify({ webhookCreated: true }),
        ],
      )
    ).rows[0];
  } else {
    const status =
      normalized.eventType === "completed"
        ? "completed"
        : normalized.eventType === "failed"
          ? "failed"
          : ["answered", "ringing", "initiated"].includes(normalized.eventType)
            ? "in_progress"
            : conversation.status;
    if (
      status !== conversation.status &&
      telephonyTransitionAllowed(conversation.status, normalized.eventType)
    ) {
      conversation = (
        await client.query(
          `UPDATE tenant.crm_conversations SET status=$3,ended_at=CASE WHEN $3 IN ('completed','failed') THEN $4 ELSE ended_at END,
          duration_seconds=GREATEST(COALESCE(duration_seconds,0),$5),provider_call_id=COALESCE(provider_call_id,$6),updated_at=now(),updated_by=$7
         WHERE organization_id=$1 AND id=$2 RETURNING *`,
          [
            context.organizationId,
            conversation.id,
            status,
            normalized.occurredAt,
            normalized.durationSeconds,
            normalized.providerCallId,
            context.userId,
          ],
        )
      ).rows[0];
    }
  }
  await client
    .query(
      `UPDATE tenant.crm_telephony_events SET conversation_id=$3 WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, inserted.rows[0].id, conversation.id],
    )
    .catch(() => undefined);
  if (normalized.recordingReference) {
    await registerConversationRecording(client, context, conversation.id, {
      provider: normalized.provider,
      providerRecordingId: normalized.recordingId,
      storageReference: normalized.recordingReference,
      durationSeconds: normalized.durationSeconds,
      consentStatus: conversation.consent_status,
      retentionUntil: conversation.retention_until,
    });
  }
  await client.query(
    `UPDATE tenant.crm_telephony_connections SET last_webhook_at=now(),last_error=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, connectionId],
  );
  return { duplicate: false, conversation };
}

export async function registerConversationRecording(
  client,
  context,
  conversationIdValue,
  input = {},
) {
  const conversationId = assertId(conversationIdValue, "Conversation");
  const conversation = (
    await client.query(
      `SELECT * FROM tenant.crm_conversations WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, conversationId],
    )
  ).rows[0];
  if (!conversation)
    throw new CrmConversationIntelligenceError(
      404,
      "Conversation not found.",
      "CRM_CONVERSATION_NOT_FOUND",
    );
  const consentStatus = text(
    input.consentStatus || conversation.consent_status || "unknown",
  );
  if (consentStatus === "denied")
    throw new CrmConversationIntelligenceError(
      409,
      "A recording cannot be stored when consent is denied.",
      "CRM_RECORDING_CONSENT_DENIED",
    );
  const retentionUntil = new Date(
    input.retentionUntil ||
      conversation.retention_until ||
      Date.now() + 90 * 86400000,
  ).toISOString();
  const result = await client.query(
    `INSERT INTO tenant.crm_conversation_recordings(
       organization_id,conversation_id,provider,provider_recording_id,storage_reference,media_type,
       duration_seconds,byte_size,checksum_sha256,consent_status,retention_until,status,metadata,created_by
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'available',$12,$13)
     ON CONFLICT (organization_id,provider,provider_recording_id) DO UPDATE SET
       storage_reference=EXCLUDED.storage_reference,duration_seconds=EXCLUDED.duration_seconds,
       byte_size=EXCLUDED.byte_size,checksum_sha256=EXCLUDED.checksum_sha256,status='available',updated_at=now()
     RETURNING *`,
    [
      context.organizationId,
      conversationId,
      text(input.provider || conversation.provider || "custom"),
      text(input.providerRecordingId) || null,
      text(input.storageReference),
      text(input.mediaType) || "audio/mpeg",
      input.durationSeconds == null
        ? null
        : Math.max(0, integer(input.durationSeconds)),
      input.byteSize == null ? null : Math.max(0, integer(input.byteSize)),
      text(input.checksumSha256) || null,
      consentStatus,
      retentionUntil,
      JSON.stringify(object(input.metadata)),
      context.userId,
    ],
  );
  await client.query(
    `UPDATE tenant.crm_conversations SET recording_reference=$3,recording_status='available',updated_at=now(),updated_by=$4 WHERE organization_id=$1 AND id=$2`,
    [
      context.organizationId,
      conversationId,
      result.rows[0].storage_reference,
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function issueRecordingAccessGrant(
  client,
  context,
  recordingIdValue,
  input = {},
) {
  const recordingId = assertId(recordingIdValue, "Recording");
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const minutes = Math.min(
    60,
    Math.max(1, integer(input.expiresInMinutes, 10)),
  );
  const row = (
    await client.query(
      `INSERT INTO tenant.crm_recording_access_grants(
       organization_id,recording_id,token_hash,purpose,expires_at,issued_to,issued_by
     ) SELECT $1,recording.id,$3,$4,now()+make_interval(mins=>$5),$6,$6
       FROM tenant.crm_conversation_recordings recording
       WHERE recording.organization_id=$1 AND recording.id=$2 AND recording.status='available' AND recording.retention_until>now()
       RETURNING *`,
      [
        context.organizationId,
        recordingId,
        tokenHash,
        text(input.purpose) || "review",
        minutes,
        context.userId,
      ],
    )
  ).rows[0];
  if (!row)
    throw new CrmConversationIntelligenceError(
      404,
      "Available recording not found.",
      "CRM_RECORDING_NOT_FOUND",
    );
  return { ...row, token: rawToken };
}

export async function requestConversationTranscription(
  client,
  context,
  conversationIdValue,
  input = {},
) {
  const conversationId = assertId(conversationIdValue, "Conversation");
  const recording = (
    await client.query(
      `SELECT * FROM tenant.crm_conversation_recordings WHERE organization_id=$1 AND conversation_id=$2 AND status='available' AND retention_until>now() ORDER BY created_at DESC LIMIT 1`,
      [context.organizationId, conversationId],
    )
  ).rows[0];
  if (!recording)
    throw new CrmConversationIntelligenceError(
      409,
      "An available recording is required.",
      "CRM_TRANSCRIPTION_RECORDING_REQUIRED",
    );
  if (!["granted", "not_required"].includes(recording.consent_status))
    throw new CrmConversationIntelligenceError(
      409,
      "Recording consent does not allow transcription.",
      "CRM_TRANSCRIPTION_CONSENT_REQUIRED",
    );
  const provider = text(input.provider || "mock").toLowerCase();
  if (
    ![
      "openai",
      "azure",
      "google",
      "aws",
      "deepgram",
      "mock",
      "custom",
    ].includes(provider)
  )
    throw new CrmConversationIntelligenceError(
      400,
      "Unsupported transcription provider.",
      "CRM_TRANSCRIPTION_PROVIDER_INVALID",
    );
  const idempotencyKey =
    text(input.idempotencyKey) ||
    crmConversationHash({
      conversationId,
      recordingId: recording.id,
      provider,
    });
  const result = await client.query(
    `INSERT INTO tenant.crm_transcription_jobs(
       organization_id,conversation_id,recording_id,provider,credential_reference,language_code,
       diarization_enabled,redaction_enabled,idempotency_key,status,created_by
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued',$10)
     ON CONFLICT (organization_id,idempotency_key) DO UPDATE SET updated_at=now() RETURNING *`,
    [
      context.organizationId,
      conversationId,
      recording.id,
      provider,
      text(input.credentialReference) || null,
      text(input.languageCode) || "en-IN",
      input.diarizationEnabled !== false,
      input.redactionEnabled !== false,
      idempotencyKey,
      context.userId,
    ],
  );
  await client.query(
    `UPDATE tenant.crm_conversations SET transcript_status='queued',updated_at=now(),updated_by=$3 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, conversationId, context.userId],
  );
  return result.rows[0];
}

export async function completeConversationTranscription(
  client,
  context,
  jobIdValue,
  input = {},
) {
  const jobId = assertId(jobIdValue, "Transcription job");
  const job = (
    await client.query(
      `SELECT * FROM tenant.crm_transcription_jobs WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [context.organizationId, jobId],
    )
  ).rows[0];
  if (!job)
    throw new CrmConversationIntelligenceError(
      404,
      "Transcription job not found.",
      "CRM_TRANSCRIPTION_JOB_NOT_FOUND",
    );
  if (job.status === "completed")
    return (
      await client.query(
        `SELECT * FROM tenant.crm_conversation_transcripts WHERE organization_id=$1 AND job_id=$2`,
        [context.organizationId, jobId],
      )
    ).rows[0];
  const transcriptText = text(input.transcriptText);
  if (!transcriptText)
    throw new CrmConversationIntelligenceError(
      400,
      "Transcript text is required.",
      "CRM_TRANSCRIPT_REQUIRED",
    );
  const redactedText = text(input.redactedText) || null;
  const transcript = (
    await client.query(
      `INSERT INTO tenant.crm_conversation_transcripts(
       organization_id,conversation_id,recording_id,job_id,language_code,transcript_text,redacted_text,
       confidence,provider,provider_model,content_hash,status
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'ready') RETURNING *`,
      [
        context.organizationId,
        job.conversation_id,
        job.recording_id,
        job.id,
        text(input.languageCode || job.language_code),
        transcriptText,
        redactedText,
        input.confidence == null ? null : Number(input.confidence),
        job.provider,
        text(input.providerModel) || null,
        crmConversationHash({ transcriptText, redactedText }),
      ],
    )
  ).rows[0];
  let sequence = 0;
  for (const segment of array(input.segments)) {
    sequence += 1;
    await client.query(
      `INSERT INTO tenant.crm_transcript_segments(organization_id,transcript_id,sequence,speaker_label,started_ms,ended_ms,text,confidence)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        context.organizationId,
        transcript.id,
        sequence,
        text(segment.speakerLabel) || `Speaker ${sequence}`,
        Math.max(0, integer(segment.startedMs)),
        Math.max(integer(segment.startedMs), integer(segment.endedMs)),
        text(segment.text),
        segment.confidence == null ? null : Number(segment.confidence),
      ],
    );
  }
  const insights = buildConversationInsights({
    transcript: redactedText || transcriptText,
    summary: input.summary,
    actionItems: input.actionItems,
    signals: input.signals,
  });
  if (insights.summary) {
    await client.query(
      `INSERT INTO tenant.crm_conversation_insights(organization_id,company_id,conversation_id,insight_type,title,content,model_provider,model_name,requires_review,review_status)
       SELECT $1,conversation.company_id,$2,'summary','Conversation summary',$3,$4,$5,true,'pending'
       FROM tenant.crm_conversations conversation WHERE conversation.organization_id=$1 AND conversation.id=$2`,
      [
        context.organizationId,
        job.conversation_id,
        insights.summary,
        job.provider,
        text(input.providerModel) || null,
      ],
    );
  }
  for (const signal of insights.signals) {
    await client.query(
      `INSERT INTO tenant.crm_conversation_insights(organization_id,company_id,conversation_id,insight_type,title,content,score,evidence,model_provider,model_name,requires_review,review_status)
       SELECT $1,conversation.company_id,$2,$3,$4,$5,$6,$7,$8,$9,true,'pending'
       FROM tenant.crm_conversations conversation WHERE conversation.organization_id=$1 AND conversation.id=$2`,
      [
        context.organizationId,
        job.conversation_id,
        [
          "sentiment",
          "topic",
          "objection",
          "commitment",
          "next_action",
          "risk",
          "coaching",
        ].includes(signal.type)
          ? signal.type
          : "topic",
        signal.title,
        signal.content,
        signal.score,
        JSON.stringify(signal.evidence),
        job.provider,
        text(input.providerModel) || null,
      ],
    );
  }
  for (const item of insights.actionItems) {
    await client.query(
      `INSERT INTO tenant.crm_conversation_action_items(organization_id,conversation_id,transcript_id,title,description,owner_user_id,due_at,source,evidence,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,'transcript',$8,$9)`,
      [
        context.organizationId,
        job.conversation_id,
        transcript.id,
        item.title,
        item.description,
        item.ownerUserId || context.userId,
        item.dueAt,
        JSON.stringify(item.evidence),
        context.userId,
      ],
    );
  }
  await client.query(
    `UPDATE tenant.crm_transcription_jobs SET status='completed',completed_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, job.id],
  );
  await client.query(
    `UPDATE tenant.crm_conversations SET transcript_status='ready',updated_at=now(),updated_by=$3 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, job.conversation_id, context.userId],
  );
  return transcript;
}

export async function getConversationIntelligenceTimeline(
  client,
  context,
  input = {},
) {
  const conversationId = input.conversationId
    ? assertId(input.conversationId, "Conversation")
    : null;
  const result = await client.query(
    `SELECT conversation.id,conversation.title,conversation.channel,conversation.direction,conversation.provider,
       conversation.from_number,conversation.to_number,conversation.status,conversation.started_at,conversation.ended_at,
       conversation.duration_seconds,conversation.recording_status,conversation.transcript_status,
       COALESCE(jsonb_agg(DISTINCT jsonb_build_object('type',insight.insight_type,'title',insight.title,'content',insight.content,'reviewStatus',insight.review_status)) FILTER (WHERE insight.id IS NOT NULL),'[]'::jsonb) AS insights,
       COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id',item.id,'title',item.title,'status',item.status,'dueAt',item.due_at)) FILTER (WHERE item.id IS NOT NULL),'[]'::jsonb) AS action_items
     FROM tenant.crm_conversations conversation
     LEFT JOIN tenant.crm_conversation_insights insight ON insight.organization_id=conversation.organization_id AND insight.conversation_id=conversation.id
     LEFT JOIN tenant.crm_conversation_action_items item ON item.organization_id=conversation.organization_id AND item.conversation_id=conversation.id
     WHERE conversation.organization_id=$1 AND conversation.channel IN ('call','meeting','video') AND ($2::uuid IS NULL OR conversation.id=$2)
     GROUP BY conversation.id ORDER BY conversation.started_at DESC LIMIT $3`,
    [
      context.organizationId,
      conversationId,
      Math.min(100, Math.max(1, integer(input.limit, 50))),
    ],
  );
  return result.rows;
}

export async function getConversationIntelligenceDashboard(client, context) {
  const summary = (
    await client.query(
      `SELECT
       count(*) FILTER (WHERE channel='call' AND started_at>=now()-interval '30 days')::int AS calls_30d,
       count(*) FILTER (WHERE status='in_progress')::int AS active_calls,
       count(*) FILTER (WHERE recording_status='available')::int AS recordings_available,
       count(*) FILTER (WHERE transcript_status IN ('queued','processing'))::int AS transcripts_pending,
       count(*) FILTER (WHERE transcript_status='ready')::int AS transcripts_ready,
       COALESCE(avg(duration_seconds) FILTER (WHERE duration_seconds IS NOT NULL),0)::numeric(12,2) AS average_duration_seconds
     FROM tenant.crm_conversations WHERE organization_id=$1 AND channel IN ('call','meeting','video')`,
      [context.organizationId],
    )
  ).rows[0];
  const connections = (
    await client.query(
      `SELECT id,provider,display_name,status,recording_enabled,transcription_enabled,last_webhook_at,last_error
     FROM tenant.crm_telephony_connections WHERE organization_id=$1 ORDER BY display_name`,
      [context.organizationId],
    )
  ).rows;
  const jobs = (
    await client.query(
      `SELECT id,conversation_id,provider,status,attempts,created_at,last_error
     FROM tenant.crm_transcription_jobs WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 20`,
      [context.organizationId],
    )
  ).rows;
  const recent = await getConversationIntelligenceTimeline(client, context, {
    limit: 20,
  });
  return { summary, connections, jobs, recent };
}

export async function recordCrmConversationAcceptance(
  client,
  context,
  input = {},
) {
  const capabilityId = text(input.capabilityId);
  if (!CRM_CONVERSATION_CAPABILITY_IDS.includes(capabilityId))
    throw new CrmConversationIntelligenceError(
      400,
      "Unknown CRM-05 capability.",
      "CRM_CAPABILITY_INVALID",
    );
  const evidence = object(input.evidence);
  const result = await client.query(
    `INSERT INTO tenant.crm_conversation_acceptance_runs(
       organization_id,capability_id,status,commit_sha,evidence,evidence_hash,provider_acceptance,recorded_by
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (organization_id,capability_id,commit_sha) DO NOTHING RETURNING *`,
    [
      context.organizationId,
      capabilityId,
      text(input.status) || "passed",
      text(input.commitSha) || "working-tree",
      JSON.stringify(evidence),
      crmConversationHash(evidence),
      text(input.providerAcceptance) || "sandbox",
      context.userId,
    ],
  );
  return result.rows[0] || null;
}

export async function getCrmConversationReadiness(client, context) {
  const acceptance = (
    await client.query(
      `SELECT capability_id,status,provider_acceptance,recorded_at FROM tenant.crm_conversation_acceptance_runs
     WHERE organization_id=$1 ORDER BY recorded_at DESC`,
      [context.organizationId],
    )
  ).rows;
  const latest = new Map();
  for (const row of acceptance)
    if (!latest.has(row.capability_id)) latest.set(row.capability_id, row);
  const checks = CRM_CONVERSATION_CAPABILITY_IDS.map((id) => ({
    id,
    ...(latest.get(id) || {
      status: "missing",
      provider_acceptance: "sandbox",
    }),
  }));
  const passed = checks.filter((row) => row.status === "passed").length;
  const providerProduction = checks.filter(
    (row) =>
      row.provider_acceptance === "production" ||
      row.provider_acceptance === "not_required",
  ).length;
  return {
    readiness: passed === checks.length ? "ready" : "blocked",
    score: Math.round((passed / checks.length) * 100),
    providerReadiness:
      providerProduction === checks.length ? "production" : "sandbox",
    checks,
  };
}
