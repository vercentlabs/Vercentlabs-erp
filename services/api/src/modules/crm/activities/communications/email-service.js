// F018 email: outbound composition (templates, signatures), consent,
// suppression and the send-window/throttle decision, queuing, mailbox
// ingestion into CRM communications/threads/messages, engagement events, and
// the email history / thread / dashboard reads. Provider transport lives in
// provider-integrations.js; shared-inbox membership in shared-inbox-service.js.

import { randomBytes } from "node:crypto";
import { publishDomainEvent } from "../../../../core/platform/events/index.js";
import { leadScopeSql } from "../../lead-management/lead-security.js";
import { resolveCrmEntityAccess } from "../timeline/timeline.js";
import { communicationVisibilitySql, projectCrmCommunications, resolveCommunicationParticipants } from "./communication-projection.js";
import { CrmCommunicationsError, assertId } from "./communications-error.js";
import { crmCommunicationsHash } from "./content-hash.js";
import { normalizeEmailAddress, optionalEmail } from "./email-address.js";
import { loadSyncAccount, normalizeProviderMessage } from "./provider-integrations.js";
import { listThreadMessages } from "./shared-inbox-service.js";

const text = (value) => String(value ?? "").trim();
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = (value) => (Array.isArray(value) ? value : []);
const integer = (value, fallback = 0) =>
  Number.isInteger(Number(value)) ? Number(value) : fallback;

function renderCommunicationTemplate(value, variables = {}) {
  const source = text(value);
  const data = object(variables);
  return source.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key) => {
    const segments = String(key).split(".");
    let current = data;
    for (const segment of segments) {
      if (!current || typeof current !== "object" || !(segment in current))
        return "";
      current = current[segment];
    }
    return current == null ? "" : String(current);
  });
}

async function resolveOutboundEmailComposition(client, context, input) {
  let subject = text(input.subject);
  let bodyText = text(input.bodyText);
  let bodyHtml = text(input.bodyHtml);
  const variables = object(input.variables);
  const templateId = text(input.templateId);
  const signatureId = text(input.signatureId);

  if (templateId) {
    const template = await client.query(
      `SELECT id,subject_template,body_template,language_code
       FROM tenant.crm_engagement_templates
       WHERE organization_id=$1 AND id=$2 AND template_type='email' AND status='active'`,
      [context.organizationId, assertId(templateId, "Email template")],
    );
    if (!template.rows[0]) {
      throw new CrmCommunicationsError(
        404,
        "Active email template not found.",
        "CRM_EMAIL_TEMPLATE_NOT_FOUND",
      );
    }
    if (!subject)
      subject = renderCommunicationTemplate(
        template.rows[0].subject_template,
        variables,
      );
    if (!bodyText && !bodyHtml) {
      bodyHtml = renderCommunicationTemplate(
        template.rows[0].body_template,
        variables,
      );
      bodyText = bodyHtml
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  if (signatureId) {
    const signature = await client.query(
      `SELECT id,body_html,body_text
       FROM tenant.crm_email_signatures
       WHERE organization_id=$1 AND id=$2 AND status='active'`,
      [context.organizationId, assertId(signatureId, "Email signature")],
    );
    if (!signature.rows[0]) {
      throw new CrmCommunicationsError(
        404,
        "Active email signature not found.",
        "CRM_EMAIL_SIGNATURE_NOT_FOUND",
      );
    }
    bodyHtml = [bodyHtml, text(signature.rows[0].body_html)]
      .filter(Boolean)
      .join("<br><br>");
    bodyText = [
      bodyText,
      text(signature.rows[0].body_text) ||
        text(signature.rows[0].body_html)
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (!subject) {
    throw new CrmCommunicationsError(
      400,
      "Email subject is required.",
      "CRM_EMAIL_SUBJECT_REQUIRED",
    );
  }
  if (!bodyText && !bodyHtml) {
    throw new CrmCommunicationsError(
      400,
      "Email body is required.",
      "CRM_EMAIL_BODY_REQUIRED",
    );
  }

  return { subject, bodyText: bodyText || null, bodyHtml: bodyHtml || null };
}

export function outboundSendDecision({
  now = new Date(),
  timezone = "UTC",
  sendWindow = { start: "08:00", end: "20:00" },
  sentLastHour = 0,
  hourlyLimit = 200,
  suppressed = false,
}) {
  if (suppressed) return { allowed: false, reason: "suppressed" };
  if (Number(sentLastHour) >= Number(hourlyLimit))
    return { allowed: false, reason: "throttled" };
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value || 0,
  );
  const current = hour * 60 + minute;
  const [startHour, startMinute] = text(sendWindow.start || "08:00")
    .split(":")
    .map(Number);
  const [endHour, endMinute] = text(sendWindow.end || "20:00")
    .split(":")
    .map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  if (current < start || current > end)
    return { allowed: false, reason: "outside_send_window" };
  return { allowed: true, reason: null };
}

export async function upsertEmailSignature(client, context, input = {}) {
  const signatureId = input.id ? assertId(input.id, "Signature") : null;
  const bodyHtml = text(input.bodyHtml);
  if (!bodyHtml) {
    throw new CrmCommunicationsError(400, "Signature HTML is required.");
  }
  if (input.isDefault === true) {
    await client.query(
      `UPDATE tenant.crm_email_signatures SET is_default=false,updated_at=now()
       WHERE organization_id=$1 AND user_id=$2 AND status='active'`,
      [context.organizationId, input.userId || context.userId],
    );
  }
  const result = signatureId
    ? await client.query(
        `UPDATE tenant.crm_email_signatures SET name=$3,body_html=$4,body_text=$5,
           is_default=$6,status=$7,updated_by=$8,updated_at=now()
         WHERE organization_id=$1 AND id=$2 RETURNING *`,
        [
          context.organizationId,
          signatureId,
          text(input.name),
          bodyHtml,
          text(input.bodyText) || null,
          Boolean(input.isDefault),
          text(input.status) || "active",
          context.userId,
        ],
      )
    : await client.query(
        `INSERT INTO tenant.crm_email_signatures(
           organization_id,company_id,user_id,name,body_html,body_text,is_default,
           status,created_by,updated_by
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
        [
          context.organizationId,
          input.companyId || context.activeCompanyId || null,
          input.userId || context.userId,
          text(input.name),
          bodyHtml,
          text(input.bodyText) || null,
          Boolean(input.isDefault),
          text(input.status) || "active",
          context.userId,
        ],
      );
  if (!result.rows[0]) {
    throw new CrmCommunicationsError(404, "Email signature not found.");
  }
  return result.rows[0];
}

export async function listEmailSignatures(client, context) {
  const result = await client.query(
    `SELECT * FROM tenant.crm_email_signatures
     WHERE organization_id=$1 AND status<>'archived'
       AND (user_id=$2 OR user_id IS NULL)
     ORDER BY is_default DESC,name`,
    [context.organizationId, context.userId],
  );
  return result.rows;
}

export async function ingestMailboxDelta(
  client,
  context,
  syncAccountId,
  input = {},
) {
  const account = await loadSyncAccount(client, context, syncAccountId);
  const provider = text(input.provider || account.provider).toLowerCase();
  const messages = array(input.messages).map((row) =>
    normalizeProviderMessage(provider, row),
  );
  let inserted = 0;
  let duplicates = 0;
  for (const message of messages) {
    const thread = await client.query(
      `INSERT INTO tenant.crm_email_threads(organization_id,company_id,inbox_id,sync_account_id,provider,external_thread_id,subject,preview,participant_addresses,lead_id,opportunity_id,party_id,contact_id,first_response_due_at,last_message_at,unread_count,status,metadata,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,CASE WHEN $14='inbound' THEN now()+COALESCE((SELECT sla_minutes FROM tenant.crm_shared_inboxes WHERE organization_id=$1 AND id=$3),240)*interval '1 minute' END,$15,CASE WHEN $16 THEN 1 ELSE 0 END,'open',$17,$18,$18)
       ON CONFLICT (organization_id,provider,external_thread_id) DO UPDATE SET subject=COALESCE(EXCLUDED.subject,tenant.crm_email_threads.subject),preview=EXCLUDED.preview,participant_addresses=EXCLUDED.participant_addresses,last_message_at=GREATEST(tenant.crm_email_threads.last_message_at,EXCLUDED.last_message_at),first_responded_at=CASE WHEN $14='outbound' AND tenant.crm_email_threads.first_response_due_at IS NOT NULL THEN COALESCE(tenant.crm_email_threads.first_responded_at,EXCLUDED.last_message_at) ELSE tenant.crm_email_threads.first_responded_at END,unread_count=tenant.crm_email_threads.unread_count+EXCLUDED.unread_count,updated_at=now()
       RETURNING *`,
      [
        context.organizationId,
        input.companyId ||
          account.company_id ||
          context.activeCompanyId ||
          null,
        input.inboxId || null,
        account.id,
        provider,
        message.externalThreadId,
        message.subject || null,
        text(message.bodyText).slice(0, 300) || null,
        [
          ...new Set([
            message.fromAddress,
            ...message.toAddresses,
            ...message.ccAddresses,
          ]),
        ],
        input.leadId || null,
        input.opportunityId || null,
        input.partyId || null,
        input.contactId || null,
        message.direction,
        message.occurredAt,
        message.unread,
        JSON.stringify(message.metadata),
        context.userId,
      ],
    );
    const communication = await client.query(
      `INSERT INTO tenant.crm_communications(organization_id,channel,direction,lead_id,opportunity_id,party_id,contact_id,provider,provider_message_id,subject,body,from_address,to_addresses,status,occurred_at,metadata,created_by,updated_by)
       VALUES($1,'email',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
       ON CONFLICT (organization_id,provider,provider_message_id) DO UPDATE SET metadata=tenant.crm_communications.metadata||EXCLUDED.metadata,updated_at=now()
       RETURNING *`,
      [
        context.organizationId,
        message.direction,
        input.leadId || null,
        input.opportunityId || null,
        input.partyId || null,
        input.contactId || null,
        provider,
        message.providerMessageId,
        message.subject || null,
        message.bodyText || null,
        message.fromAddress,
        message.toAddresses,
        message.status,
        message.occurredAt,
        JSON.stringify(message.metadata),
        context.userId,
      ],
    );
    // F018 §1 closeout — resolves this message's actual participants
    // (sender/recipients/cc/bcc) against public.users (internal) and
    // tenant.contacts (external, metadata only — never application
    // access), so the 'participant' visibility tier and content
    // projection below have something real to check against.
    await resolveCommunicationParticipants(client, context, communication.rows[0].id, [
      { role: "sender", email: message.fromAddress },
      ...message.toAddresses.map((email) => ({ role: "recipient", email })),
      ...message.ccAddresses.map((email) => ({ role: "cc", email })),
      ...message.bccAddresses.map((email) => ({ role: "bcc", email })),
    ]);
    const insertedMessage = await client.query(
      `INSERT INTO tenant.crm_email_messages(organization_id,thread_id,communication_id,sync_account_id,provider,provider_message_id,internet_message_id,direction,from_address,to_addresses,cc_addresses,bcc_addresses,reply_to_addresses,subject,body_text,body_html,sent_at,received_at,status,provider_payload_hash,headers,metadata,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,CASE WHEN $8='outbound' THEN $17::timestamptz END,CASE WHEN $8='inbound' THEN $17::timestamptz END,$18,$19,$20,$21,$22)
       ON CONFLICT (organization_id,provider,provider_message_id) DO NOTHING RETURNING id`,
      [
        context.organizationId,
        thread.rows[0].id,
        communication.rows[0].id,
        account.id,
        provider,
        message.providerMessageId,
        message.internetMessageId,
        message.direction,
        message.fromAddress,
        message.toAddresses,
        message.ccAddresses,
        message.bccAddresses,
        message.replyToAddresses,
        message.subject || null,
        message.bodyText || null,
        message.bodyHtml || null,
        message.occurredAt,
        message.status,
        crmCommunicationsHash(message.raw),
        JSON.stringify(message.headers),
        JSON.stringify(message.metadata),
        context.userId,
      ],
    );
    if (insertedMessage.rows[0]) inserted += 1;
    else duplicates += 1;
  }
  await client.query(
    `UPDATE tenant.crm_sync_accounts SET sync_cursor=$3,last_synced_at=now(),last_inbound_at=CASE WHEN $4>0 THEN now() ELSE last_inbound_at END,last_error=NULL,status='connected',sync_lock_until=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [
      context.organizationId,
      account.id,
      text(input.nextCursor) || account.sync_cursor || null,
      inserted,
    ],
  );
  return {
    inserted,
    duplicates,
    nextCursor: text(input.nextCursor) || account.sync_cursor || null,
  };
}

export async function recordEmailEngagementEvent(client, context, input = {}) {
  const provider = text(input.provider) || "other";
  const providerMessageId = text(input.providerMessageId);
  const message = await client.query(
    `SELECT * FROM tenant.crm_email_messages WHERE organization_id=$1 AND provider=$2 AND provider_message_id=$3`,
    [context.organizationId, provider, providerMessageId],
  );
  if (!message.rows[0])
    throw new CrmCommunicationsError(404, "Email message not found.");
  const eventType = text(input.eventType).toLowerCase();
  if (
    ![
      "delivered",
      "open",
      "click",
      "soft_bounce",
      "hard_bounce",
      "complaint",
      "unsubscribe",
    ].includes(eventType)
  )
    throw new CrmCommunicationsError(400, "Email event type is invalid.");
  const eventId =
    text(input.providerEventId) ||
    crmCommunicationsHash({
      providerMessageId,
      eventType,
      occurredAt: input.occurredAt,
      url: input.url,
    });
  const event = await client.query(
    `INSERT INTO tenant.crm_email_events(organization_id,message_id,provider,provider_event_id,event_type,occurred_at,url,reason,recipient,payload_hash,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (organization_id,provider,provider_event_id) DO NOTHING RETURNING *`,
    [
      context.organizationId,
      message.rows[0].id,
      provider,
      eventId,
      eventType,
      text(input.occurredAt) || new Date().toISOString(),
      text(input.url) || null,
      text(input.reason) || null,
      optionalEmail(input.recipient),
      crmCommunicationsHash(input),
      JSON.stringify(object(input.metadata)),
    ],
  );
  if (!event.rows[0]) return { duplicate: true };
  const statusMap = {
    delivered: "delivered",
    open: "opened",
    click: "clicked",
    soft_bounce: "bounced",
    hard_bounce: "bounced",
    complaint: "complained",
    unsubscribe: "unsubscribed",
  };
  await client.query(
    `UPDATE tenant.crm_email_messages SET status=$3 WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, message.rows[0].id, statusMap[eventType]],
  );
  await client.query(
    `UPDATE tenant.crm_communications SET status=CASE WHEN $3='opened' THEN 'read' WHEN $3 IN ('delivered','clicked') THEN 'delivered' WHEN $3 IN ('bounced','complained','unsubscribed') THEN 'failed' ELSE status END,updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [
      context.organizationId,
      message.rows[0].communication_id,
      statusMap[eventType],
    ],
  );
  if (["hard_bounce", "complaint", "unsubscribe"].includes(eventType)) {
    const recipient =
      optionalEmail(input.recipient) ||
      optionalEmail(message.rows[0].to_addresses?.[0]);
    if (recipient) {
      await client.query(
        `INSERT INTO tenant.crm_email_suppressions(organization_id,email_address,reason,source_event_id,status,created_by)
         VALUES($1,$2,$3,$4,'active',$5) ON CONFLICT (organization_id,email_address) DO UPDATE SET reason=EXCLUDED.reason,source_event_id=EXCLUDED.source_event_id,status='active',suppressed_at=now(),revoked_at=NULL,revoked_by=NULL`,
        [
          context.organizationId,
          recipient,
          eventType === "hard_bounce" ? "hard_bounce" : eventType,
          event.rows[0].id,
          context.userId,
        ],
      );
    }
  }
  return { duplicate: false, event: event.rows[0] };
}

// Prompt 6 (F018) closeout: Prompt-3 built a real consent ledger
// (crm_consent_events) and a Lead-level do_not_contact flag (already
// enforced for outbound Calls — see call-operations.js's
// CRM_CALL_DO_NOT_CONTACT), but the email send path never consulted
// either — only crm_email_suppressions (a narrower, provider-bounce/
// complaint/manual-unsubscribe concept) gated a send. This closes that
// specific gap: an explicit Lead do-not-contact flag, or the most recent
// crm_consent_events row recording an explicit withdrawal/suppression for
// this subject+channel, now blocks the send the same way suppression
// already does. This deliberately does NOT introduce an opt-in-required
// gate — crm_leads.consent_email defaults to false for essentially every
// existing Lead (capture-time flag, not a ledger), so treating "no
// consent recorded" as blocking would break ordinary business email that
// was never subject to a strict opt-in requirement. It only respects an
// EXPLICIT negative signal, matching the dossier's own language ("opt-
// out... do-not-contact... suppression"), not a broader redesign.
export async function assertEmailConsent(client, context, { leadId, contactId, partyId }) {
  if (leadId) {
    const lead = await client.query(
      `SELECT do_not_contact FROM tenant.crm_leads WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, leadId],
    );
    if (lead.rows[0]?.do_not_contact)
      return { allowed: false, reason: "do_not_contact" };
  }
  if (!leadId && !contactId && !partyId) return { allowed: true, reason: null };
  const consent = await client.query(
    `SELECT action FROM tenant.crm_consent_events
      WHERE organization_id=$1 AND channel IN ('email','all')
        AND ((lead_id=$2 AND $2::uuid IS NOT NULL) OR (contact_id=$3 AND $3::uuid IS NOT NULL) OR (party_id=$4 AND $4::uuid IS NOT NULL))
      ORDER BY occurred_at DESC LIMIT 1`,
    [context.organizationId, leadId || null, contactId || null, partyId || null],
  );
  const latestAction = consent.rows[0]?.action;
  if (latestAction === "withdrawn" || latestAction === "suppressed")
    return { allowed: false, reason: "consent_withdrawn" };
  return { allowed: true, reason: null };
}

export async function queueOutboundEmail(client, context, input = {}) {
  const composition = await resolveOutboundEmailComposition(
    client,
    context,
    input,
  );
  const recipients = array(input.toAddresses).map(normalizeEmailAddress);
  if (!recipients.length)
    throw new CrmCommunicationsError(
      400,
      "At least one recipient is required.",
    );
  const consentDecision = await assertEmailConsent(client, context, {
    leadId: input.leadId || null,
    contactId: input.contactId || null,
    partyId: input.partyId || null,
  });
  if (!consentDecision.allowed)
    throw new CrmCommunicationsError(
      409,
      `Email cannot be queued: ${consentDecision.reason}.`,
      `CRM_EMAIL_${String(consentDecision.reason).toUpperCase()}`,
    );
  const suppression = await client.query(
    `SELECT email_address FROM tenant.crm_email_suppressions WHERE organization_id=$1 AND email_address=ANY($2::text[]) AND status='active' AND (expires_at IS NULL OR expires_at>now())`,
    [context.organizationId, recipients],
  );
  const sent = await client.query(
    `SELECT count(*)::int AS total FROM tenant.crm_email_messages WHERE organization_id=$1 AND direction='outbound' AND created_at>=now()-interval '1 hour'`,
    [context.organizationId],
  );
  const decision = outboundSendDecision({
    now: input.now ? new Date(input.now) : new Date(),
    timezone: text(input.timezone) || "UTC",
    sendWindow: object(input.sendWindow),
    sentLastHour: sent.rows[0]?.total || 0,
    hourlyLimit: integer(input.hourlyLimit, 200),
    suppressed: Boolean(suppression.rows.length),
  });
  if (!decision.allowed)
    throw new CrmCommunicationsError(
      409,
      `Email cannot be queued: ${decision.reason}.`,
      `CRM_EMAIL_${String(decision.reason).toUpperCase()}`,
    );
  const providerMessageId =
    text(input.providerMessageId) ||
    `queued-${randomBytes(16).toString("hex")}`;
  const threadExternalId = text(input.externalThreadId) || providerMessageId;
  const thread = await client.query(
    `INSERT INTO tenant.crm_email_threads(organization_id,company_id,inbox_id,sync_account_id,provider,external_thread_id,subject,participant_addresses,lead_id,opportunity_id,party_id,contact_id,last_message_at,status,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),'open',$13,$13)
     ON CONFLICT (organization_id,provider,external_thread_id) DO UPDATE SET last_message_at=now(),first_responded_at=CASE WHEN tenant.crm_email_threads.first_response_due_at IS NOT NULL THEN COALESCE(tenant.crm_email_threads.first_responded_at,now()) ELSE tenant.crm_email_threads.first_responded_at END,updated_at=now() RETURNING *`,
    [
      context.organizationId,
      input.companyId || context.activeCompanyId || null,
      input.inboxId || null,
      input.syncAccountId || null,
      text(input.provider) || "manual",
      threadExternalId,
      composition.subject,
      recipients,
      input.leadId || null,
      input.opportunityId || null,
      input.partyId || null,
      input.contactId || null,
      context.userId,
    ],
  );
  const communication = await client.query(
    `INSERT INTO tenant.crm_communications(organization_id,channel,direction,lead_id,opportunity_id,party_id,contact_id,provider,provider_message_id,subject,body,from_address,to_addresses,status,occurred_at,metadata,visibility,created_by,updated_by)
     VALUES($1,'email','outbound',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'queued',now(),$12,$13,$14,$14) RETURNING *`,
    [
      context.organizationId,
      input.leadId || null,
      input.opportunityId || null,
      input.partyId || null,
      input.contactId || null,
      text(input.provider) || "manual",
      providerMessageId,
      composition.subject,
      composition.bodyText,
      normalizeEmailAddress(input.fromAddress),
      recipients,
      JSON.stringify({
        templateId: input.templateId || null,
        signatureId: input.signatureId || null,
      }),
      ["private", "participant"].includes(input.visibility) ? input.visibility : "team",
      context.userId,
    ],
  );
  // F018 §1 closeout — resolves this message's real participants
  // (sender/recipients/cc/bcc) the same way ingestMailboxDelta does for
  // inbound mail, so an outbound 'participant'-visibility send has
  // something real to check against too.
  const ccRecipients = array(input.ccAddresses).map(optionalEmail).filter(Boolean);
  const bccRecipients = array(input.bccAddresses).map(optionalEmail).filter(Boolean);
  await resolveCommunicationParticipants(client, context, communication.rows[0].id, [
    { role: "sender", email: normalizeEmailAddress(input.fromAddress) },
    ...recipients.map((email) => ({ role: "recipient", email })),
    ...ccRecipients.map((email) => ({ role: "cc", email })),
    ...bccRecipients.map((email) => ({ role: "bcc", email })),
  ]);
  const message = await client.query(
    `INSERT INTO tenant.crm_email_messages(organization_id,thread_id,communication_id,sync_account_id,provider,provider_message_id,direction,from_address,to_addresses,subject,body_text,body_html,status,provider_payload_hash,metadata,created_by)
     VALUES($1,$2,$3,$4,$5,$6,'outbound',$7,$8,$9,$10,$11,'queued',$12,$13,$14) RETURNING *`,
    [
      context.organizationId,
      thread.rows[0].id,
      communication.rows[0].id,
      input.syncAccountId || null,
      text(input.provider) || "manual",
      providerMessageId,
      normalizeEmailAddress(input.fromAddress),
      recipients,
      composition.subject,
      composition.bodyText,
      composition.bodyHtml,
      crmCommunicationsHash({
        ...input,
        subject: composition.subject,
        bodyText: composition.bodyText,
        bodyHtml: composition.bodyHtml,
      }),
      JSON.stringify({
        sendWindow: input.sendWindow || null,
        templateId: input.templateId || null,
        signatureId: input.signatureId || null,
      }),
      context.userId,
    ],
  );
  await publishDomainEvent(client, {
    organizationId: context.organizationId,
    moduleKey: "crm",
    eventType: "crm.communication.queued",
    entityType: "communication",
    entityId: communication.rows[0].id,
    payload: { provider: text(input.provider) || "manual", syncAccountId: input.syncAccountId || null, emailMessageId: message.rows[0].id },
  });
  return message.rows[0];
}

// F018 final closeout — the ONE canonical Communications projection this
// codebase's five read surfaces (record 360, canonical Timeline's
// communication branch, shared inbox thread messages, the generic
// communication API, mobile) all call — see communication-projection.js
// for the audience-vs-content split this implements. AUDIENCE (parent-
// record scope + team/private/participant tier) is enforced here in SQL;
// CONTENT (full vs metadata-only) is applied per-row afterward via
// projectCrmCommunications, so a caller who can see the Lead but lacks
// crm.leads.view_sensitive now gets metadata stubs ("Email sent, 10 Sep,
// 10:30") for team-visible mail instead of either full content (the old
// leak) or a blanket 403 (the old, coarser "you can't see anything" gate)
// — this is what the dossier's F018-SEC-002 ("stricter field/content
// visibility than record visibility") actually asks for.
export async function getCommunicationTimeline(client, context, input = {}) {
  if (input.leadId) {
    const leadValues = [context.organizationId, assertId(input.leadId, "leadId")];
    const leadScope = leadScopeSql(context, leadValues, "lead");
    const visibleLead = await client.query(
      `SELECT lead.id FROM tenant.crm_leads lead WHERE lead.organization_id=$1 AND lead.id=$2${leadScope} LIMIT 1`,
      leadValues,
    );
    if (!visibleLead.rows[0])
      throw new CrmCommunicationsError(404, "Lead not found.", "CRM_LEAD_NOT_FOUND");
  }
  const clauses = ["communication.organization_id=$1"];
  const parameters = [context.organizationId];
  for (const [field, column] of [
    ["leadId", "lead_id"],
    ["opportunityId", "opportunity_id"],
    ["partyId", "party_id"],
    ["contactId", "contact_id"],
  ]) {
    if (input[field]) {
      parameters.push(assertId(input[field], field));
      clauses.push(`communication.${column}=$${parameters.length}`);
    }
  }
  clauses.push(communicationVisibilitySql(context, parameters, "communication"));
  const result = await client.query(
    `SELECT communication.*,message.id AS email_message_id,message.status AS email_status,thread.id AS thread_id,thread.assigned_user_id,thread.first_response_due_at,thread.first_responded_at,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('type',event.event_type,'occurredAt',event.occurred_at,'url',event.url) ORDER BY event.occurred_at) FROM tenant.crm_email_events event WHERE event.organization_id=communication.organization_id AND event.message_id=message.id),'[]'::jsonb) AS engagement_events
     FROM tenant.crm_communications communication
     LEFT JOIN tenant.crm_email_messages message ON message.organization_id=communication.organization_id AND message.communication_id=communication.id
     LEFT JOIN tenant.crm_email_threads thread ON thread.organization_id=message.organization_id AND thread.id=message.thread_id
     WHERE ${clauses.join(" AND ")} ORDER BY communication.occurred_at DESC LIMIT 500`,
    parameters,
  );
  return projectCrmCommunications(client, context, result.rows);
}

function historyDto(row) {
  return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [key.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase()), value]));
}

// F018 record-level Email History: the per-record reader the Lead/
// Opportunity/Account/Contact 360s call. getCommunicationTimeline only
// scope-checks Leads, so the other parents are gated here through the same
// resolveCrmEntityAccess Timeline/Notes/Attachments use (no access = empty
// history, indistinguishable from "no email", never a partial leak).
const HISTORY_FIELD = { lead: "leadId", opportunity: "opportunityId", party: "partyId", contact: "contactId" };
export async function getCrmEmailHistory(client, context, entityType, entityId) {
  const field = HISTORY_FIELD[entityType];
  if (!field) throw new CrmCommunicationsError(400, "Unsupported record type for email history.", "CRM_EMAIL_HISTORY_ENTITY_INVALID");
  if (entityType !== "lead") {
    const allowed = await resolveCrmEntityAccess(client, context, entityType, entityId);
    if (!allowed) return [];
  }
  const rows = await getCommunicationTimeline(client, context, { [field]: entityId });
  return rows.map(historyDto);
}

// F018 conversation view of one email thread (shared-inbox membership and
// per-message content projection are listThreadMessages' own authority).
export async function getCrmEmailThread(client, context, threadId) {
  const { thread, messages } = await listThreadMessages(client, context, threadId);
  return { thread: historyDto(thread), messages: messages.map(historyDto) };
}

export async function getCommunicationsDashboard(client, context) {
  // Sequential, not Promise.all — concurrent client.query() on one shared
  // PoolClient can interleave extended-query protocol messages (observed
  // live as Postgres 08P01 "bind message supplies N parameters..."); see
  // opportunity-revenue-intelligence.js's fix for the full explanation.
  const summary = await client.query(
    `SELECT count(*) FILTER (WHERE status='open')::int AS open_threads,count(*) FILTER (WHERE status='open' AND first_response_due_at<now() AND first_responded_at IS NULL)::int AS overdue_threads,count(*) FILTER (WHERE unread_count>0)::int AS unread_threads FROM tenant.crm_email_threads WHERE organization_id=$1`,
    [context.organizationId],
  );
  const inboxes = await client.query(
    `SELECT inbox.*,count(thread.id)::int AS open_threads,count(thread.id) FILTER (WHERE thread.first_response_due_at<now() AND thread.first_responded_at IS NULL)::int AS overdue_threads FROM tenant.crm_shared_inboxes inbox LEFT JOIN tenant.crm_email_threads thread ON thread.organization_id=inbox.organization_id AND thread.inbox_id=inbox.id AND thread.status='open' WHERE inbox.organization_id=$1 GROUP BY inbox.id ORDER BY inbox.name`,
    [context.organizationId],
  );
  const threads = await client.query(
    `SELECT thread.*,inbox.name AS inbox_name FROM tenant.crm_email_threads thread LEFT JOIN tenant.crm_shared_inboxes inbox ON inbox.organization_id=thread.organization_id AND inbox.id=thread.inbox_id WHERE thread.organization_id=$1 AND thread.status IN ('open','pending') ORDER BY CASE thread.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,thread.first_response_due_at NULLS LAST,thread.last_message_at DESC LIMIT 50`,
    [context.organizationId],
  );
  const upcoming = await client.query(
    `SELECT booking.*,link.name AS meeting_name FROM tenant.crm_meeting_bookings booking JOIN tenant.crm_meeting_links link ON link.organization_id=booking.organization_id AND link.id=booking.meeting_link_id WHERE booking.organization_id=$1 AND booking.status='confirmed' AND booking.starts_at>=now() ORDER BY booking.starts_at LIMIT 20`,
    [context.organizationId],
  );
  const syncAccounts = await client.query(
    `SELECT id,provider,display_name,email_address,status,last_synced_at,last_error,webhook_expires_at FROM tenant.crm_sync_accounts WHERE organization_id=$1 ORDER BY updated_at DESC`,
    [context.organizationId],
  );
  const suppressions = await client.query(
    `SELECT count(*)::int AS active FROM tenant.crm_email_suppressions WHERE organization_id=$1 AND status='active' AND (expires_at IS NULL OR expires_at>now())`,
    [context.organizationId],
  );
  const signatures = await client.query(
    `SELECT id,name,is_default,status FROM tenant.crm_email_signatures WHERE organization_id=$1 AND status='active' AND (user_id=$2 OR user_id IS NULL) ORDER BY is_default DESC,name`,
    [context.organizationId, context.userId],
  );
  return {
    summary: {
      ...summary.rows[0],
      active_suppressions: suppressions.rows[0]?.active || 0,
    },
    inboxes: inboxes.rows,
    threads: threads.rows,
    upcomingMeetings: upcoming.rows,
    syncAccounts: syncAccounts.rows,
    signatures: signatures.rows,
  };
}
