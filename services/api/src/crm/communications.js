import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const CRM_COMMUNICATION_CAPABILITY_IDS = Object.freeze([
  "CRM-001",
  "CRM-002",
  "CRM-004",
  "CRM-005",
  "CRM-036",
  "CRM-038",
  "CRM-040",
  "CRM-045",
  "CRM-081",
]);

export class CrmCommunicationsError extends Error {
  constructor(status, message, code = "CRM_COMMUNICATIONS_ERROR") {
    super(message);
    this.name = "CrmCommunicationsError";
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
  if (!UUID.test(result)) {
    throw new CrmCommunicationsError(
      400,
      `${label} is invalid.`,
      "CRM_IDENTIFIER_INVALID",
    );
  }
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

export function crmCommunicationsHash(value) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export function normalizeEmailAddress(value) {
  const result = text(value).toLowerCase();
  if (!EMAIL.test(result)) {
    throw new CrmCommunicationsError(
      400,
      "Email address is invalid.",
      "CRM_EMAIL_INVALID",
    );
  }
  return result;
}

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
function optionalEmail(value) {
  const result = text(value).toLowerCase();
  return result && EMAIL.test(result) ? result : null;
}

function headerMap(headers) {
  return Object.fromEntries(
    array(headers).map((header) => [
      text(header?.name).toLowerCase(),
      text(header?.value),
    ]),
  );
}

function decodeBase64Url(value) {
  const input = text(value).replace(/-/g, "+").replace(/_/g, "/");
  if (!input) return "";
  try {
    return Buffer.from(input, "base64").toString("utf8");
  } catch {
    return "";
  }
}

function gmailBody(payload) {
  const current = object(payload);
  const mime = text(current.mimeType).toLowerCase();
  const direct = decodeBase64Url(object(current.body).data);
  const children = array(current.parts);
  let plain = mime === "text/plain" ? direct : "";
  let html = mime === "text/html" ? direct : "";
  for (const part of children) {
    const nested = gmailBody(part);
    if (!plain && nested.text) plain = nested.text;
    if (!html && nested.html) html = nested.html;
  }
  return { text: plain, html };
}

function parseAddressList(value) {
  return text(value)
    .split(",")
    .map((entry) => {
      const match = entry.match(/<([^>]+)>/);
      return optionalEmail(match ? match[1] : entry);
    })
    .filter(Boolean);
}

export function normalizeProviderMessage(providerValue, inputValue = {}) {
  const provider = text(providerValue).toLowerCase();
  const input = object(inputValue);
  if (provider === "gmail") {
    const headers = headerMap(object(input.payload).headers);
    const body = gmailBody(input.payload);
    return {
      provider,
      providerMessageId: text(input.id),
      externalThreadId: text(input.threadId) || text(input.id),
      internetMessageId: text(headers["message-id"]) || null,
      direction: array(input.labelIds).includes("SENT")
        ? "outbound"
        : "inbound",
      fromAddress:
        optionalEmail(parseAddressList(headers.from)[0]) ||
        "unknown@example.invalid",
      toAddresses: parseAddressList(headers.to),
      ccAddresses: parseAddressList(headers.cc),
      bccAddresses: parseAddressList(headers.bcc),
      replyToAddresses: parseAddressList(headers["reply-to"]),
      subject: text(headers.subject),
      bodyText: body.text || text(input.snippet),
      bodyHtml: body.html || null,
      occurredAt: new Date(
        Number(input.internalDate || Date.now()),
      ).toISOString(),
      status: array(input.labelIds).includes("SENT") ? "sent" : "received",
      unread: array(input.labelIds).includes("UNREAD"),
      headers,
      metadata: {
        historyId: input.historyId || null,
        labelIds: array(input.labelIds),
      },
      raw: input,
    };
  }
  if (provider === "microsoft365") {
    const fromAddress =
      optionalEmail(input.from?.emailAddress?.address) ||
      optionalEmail(input.sender?.emailAddress?.address) ||
      "unknown@example.invalid";
    return {
      provider,
      providerMessageId: text(input.id),
      externalThreadId: text(input.conversationId) || text(input.id),
      internetMessageId: text(input.internetMessageId) || null,
      direction:
        input.isDraft ||
        text(input.parentFolderId).toLowerCase().includes("sent")
          ? "outbound"
          : "inbound",
      fromAddress,
      toAddresses: array(input.toRecipients)
        .map((row) => optionalEmail(row?.emailAddress?.address))
        .filter(Boolean),
      ccAddresses: array(input.ccRecipients)
        .map((row) => optionalEmail(row?.emailAddress?.address))
        .filter(Boolean),
      bccAddresses: array(input.bccRecipients)
        .map((row) => optionalEmail(row?.emailAddress?.address))
        .filter(Boolean),
      replyToAddresses: array(input.replyTo)
        .map((row) => optionalEmail(row?.emailAddress?.address))
        .filter(Boolean),
      subject: text(input.subject),
      bodyText: text(input.bodyPreview),
      bodyHtml:
        text(input.body?.contentType).toLowerCase() === "html"
          ? text(input.body?.content)
          : null,
      occurredAt:
        text(input.receivedDateTime || input.sentDateTime) ||
        new Date().toISOString(),
      status: input.isDraft ? "draft" : "received",
      unread: input.isRead === false,
      headers: Object.fromEntries(
        array(input.internetMessageHeaders).map((header) => [
          text(header?.name).toLowerCase(),
          text(header?.value),
        ]),
      ),
      metadata: {
        changeKey: input.changeKey || null,
        categories: array(input.categories),
      },
      raw: input,
    };
  }
  const normalized = {
    provider: provider || "other",
    providerMessageId: text(input.providerMessageId || input.id),
    externalThreadId: text(
      input.externalThreadId || input.threadId || input.id,
    ),
    internetMessageId: text(input.internetMessageId) || null,
    direction: text(input.direction) === "outbound" ? "outbound" : "inbound",
    fromAddress: optionalEmail(input.fromAddress) || "unknown@example.invalid",
    toAddresses: array(input.toAddresses).map(optionalEmail).filter(Boolean),
    ccAddresses: array(input.ccAddresses).map(optionalEmail).filter(Boolean),
    bccAddresses: array(input.bccAddresses).map(optionalEmail).filter(Boolean),
    replyToAddresses: array(input.replyToAddresses)
      .map(optionalEmail)
      .filter(Boolean),
    subject: text(input.subject),
    bodyText: text(input.bodyText),
    bodyHtml: text(input.bodyHtml) || null,
    occurredAt: text(input.occurredAt) || new Date().toISOString(),
    status: text(input.status) || "received",
    unread: Boolean(input.unread),
    headers: object(input.headers),
    metadata: object(input.metadata),
    raw: input,
  };
  if (!normalized.providerMessageId || !normalized.externalThreadId) {
    throw new CrmCommunicationsError(
      400,
      "Provider message and thread identifiers are required.",
      "CRM_PROVIDER_MESSAGE_INVALID",
    );
  }
  return normalized;
}

export function normalizeProviderCalendarEvent(providerValue, inputValue = {}) {
  const provider = text(providerValue).toLowerCase();
  const input = object(inputValue);
  if (provider === "gmail" || provider === "google_calendar") {
    const start = object(input.start);
    const end = object(input.end);
    return {
      provider: "gmail",
      externalEventId: text(input.id),
      etag: text(input.etag) || null,
      title: text(input.summary) || "Busy",
      description: text(input.description) || null,
      startsAt: text(start.dateTime || start.date),
      endsAt: text(end.dateTime || end.date),
      timezone: text(start.timeZone || end.timeZone) || "UTC",
      allDay: Boolean(start.date && !start.dateTime),
      location: text(input.location) || null,
      organizerEmail: optionalEmail(input.organizer?.email),
      onlineMeetingUrl: text(input.hangoutLink) || null,
      visibility: ["public", "private", "confidential"].includes(
        text(input.visibility),
      )
        ? text(input.visibility)
        : "default",
      providerStatus: text(input.status) || "confirmed",
      attendees: array(input.attendees)
        .map((row) => ({
          emailAddress: optionalEmail(row?.email),
          displayName: text(row?.displayName) || null,
          responseStatus: text(row?.responseStatus) || "needs_action",
          isOrganizer: Boolean(row?.organizer),
        }))
        .filter((row) => row.emailAddress),
      metadata: {
        recurringEventId: input.recurringEventId || null,
        sequence: input.sequence || 0,
      },
    };
  }
  if (provider === "microsoft365") {
    return {
      provider,
      externalEventId: text(input.id),
      etag: text(input.changeKey) || null,
      title: text(input.subject) || "Busy",
      description: text(input.bodyPreview) || null,
      startsAt: text(input.start?.dateTime),
      endsAt: text(input.end?.dateTime),
      timezone: text(input.start?.timeZone || input.end?.timeZone) || "UTC",
      allDay: Boolean(input.isAllDay),
      location: text(input.location?.displayName) || null,
      organizerEmail: optionalEmail(input.organizer?.emailAddress?.address),
      onlineMeetingUrl:
        text(input.onlineMeeting?.joinUrl || input.onlineMeetingUrl) || null,
      visibility: text(input.sensitivity) === "private" ? "private" : "default",
      providerStatus: input.isCancelled ? "cancelled" : "confirmed",
      attendees: array(input.attendees)
        .map((row) => ({
          emailAddress: optionalEmail(row?.emailAddress?.address),
          displayName: text(row?.emailAddress?.name) || null,
          attendeeType: text(row?.type) || "required",
          responseStatus: text(row?.status?.response) || "needs_action",
          isOrganizer: false,
        }))
        .filter((row) => row.emailAddress),
      metadata: {
        transactionId: input.transactionId || null,
        seriesMasterId: input.seriesMasterId || null,
      },
    };
  }
  const result = {
    provider: provider || "other",
    externalEventId: text(input.externalEventId || input.id),
    etag: text(input.etag) || null,
    title: text(input.title) || "Busy",
    description: text(input.description) || null,
    startsAt: text(input.startsAt),
    endsAt: text(input.endsAt),
    timezone: text(input.timezone) || "UTC",
    allDay: Boolean(input.allDay),
    location: text(input.location) || null,
    organizerEmail: optionalEmail(input.organizerEmail),
    onlineMeetingUrl: text(input.onlineMeetingUrl) || null,
    visibility: text(input.visibility) || "default",
    providerStatus: text(input.providerStatus) || "confirmed",
    attendees: array(input.attendees),
    metadata: object(input.metadata),
  };
  if (!result.externalEventId || !result.startsAt || !result.endsAt) {
    throw new CrmCommunicationsError(
      400,
      "Calendar event identifiers and times are required.",
      "CRM_CALENDAR_EVENT_INVALID",
    );
  }
  return result;
}

export function verifyCrmProviderWebhookSignature({
  rawBody,
  timestamp,
  signature,
  secret,
  now = Date.now(),
  toleranceMs = 300000,
}) {
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > toleranceMs)
    return false;
  const provided = text(signature).replace(/^sha256=/i, "");
  if (!/^[0-9a-f]{64}$/i.test(provided) || text(secret).length < 24)
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return timingSafeEqual(
    Buffer.from(provided, "hex"),
    Buffer.from(expected, "hex"),
  );
}

export function calculateMeetingSlots({
  date,
  durationMinutes,
  bufferBeforeMinutes = 0,
  bufferAfterMinutes = 0,
  availability = {},
  busy = [],
  now = new Date(),
  minimumNoticeMinutes = 0,
}) {
  const day = new Date(`${date}T12:00:00.000Z`);
  if (Number.isNaN(day.getTime()))
    throw new CrmCommunicationsError(400, "Meeting date is invalid.");
  const weekday = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ][day.getUTCDay()];
  const windows = array(object(availability)[weekday]);
  const duration = integer(durationMinutes);
  if (duration < 5 || duration > 480)
    throw new CrmCommunicationsError(400, "Meeting duration is invalid.");
  const result = [];
  const minimumStart = new Date(
    now.getTime() + integer(minimumNoticeMinutes) * 60000,
  );
  const busyRanges = array(busy).map((row) => ({
    start: new Date(row.start || row.startsAt),
    end: new Date(row.end || row.endsAt),
  }));
  for (const window of windows) {
    const [startHour, startMinute] = text(window.start).split(":").map(Number);
    const [endHour, endMinute] = text(window.end).split(":").map(Number);
    let cursor = new Date(
      `${date}T${String(startHour).padStart(2, "0")}:${String(startMinute).padStart(2, "0")}:00.000Z`,
    );
    const windowEnd = new Date(
      `${date}T${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}:00.000Z`,
    );
    while (cursor.getTime() + duration * 60000 <= windowEnd.getTime()) {
      const end = new Date(cursor.getTime() + duration * 60000);
      const protectedStart = new Date(
        cursor.getTime() - integer(bufferBeforeMinutes) * 60000,
      );
      const protectedEnd = new Date(
        end.getTime() + integer(bufferAfterMinutes) * 60000,
      );
      const conflict = busyRanges.some(
        (range) => protectedStart < range.end && protectedEnd > range.start,
      );
      if (!conflict && cursor >= minimumStart)
        result.push({
          startsAt: cursor.toISOString(),
          endsAt: end.toISOString(),
        });
      cursor = new Date(cursor.getTime() + 15 * 60000);
    }
  }
  return result;
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

export async function createProviderOAuthState(client, context, input = {}) {
  const provider = text(input.provider).toLowerCase();
  if (!["gmail", "microsoft365"].includes(provider))
    throw new CrmCommunicationsError(
      400,
      "Provider must be Gmail or Microsoft 365.",
    );
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const stateHash = crmCommunicationsHash(state);
  const verifierHash = crmCommunicationsHash(verifier);
  const redirectUri = text(input.redirectUri);
  if (
    !redirectUri.startsWith("https://") &&
    !redirectUri.startsWith("http://localhost")
  ) {
    throw new CrmCommunicationsError(400, "OAuth redirect URI must use HTTPS.");
  }
  await client.query(
    `INSERT INTO tenant.crm_provider_oauth_states(organization_id,user_id,provider,state_hash,code_verifier_hash,redirect_uri,requested_scopes,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '10 minutes')`,
    [
      context.organizationId,
      context.userId,
      provider,
      stateHash,
      verifierHash,
      redirectUri,
      array(input.scopes),
    ],
  );
  return { state, verifier, provider, expiresInSeconds: 600 };
}

export async function consumeProviderOAuthState(client, context, input = {}) {
  const stateHash = crmCommunicationsHash(text(input.state));
  const verifierHash = crmCommunicationsHash(text(input.verifier));
  const result = await client.query(
    `UPDATE tenant.crm_provider_oauth_states
     SET consumed_at=now()
     WHERE organization_id=$1 AND state_hash=$2 AND code_verifier_hash=$3 AND consumed_at IS NULL AND expires_at>now()
     RETURNING provider,redirect_uri,requested_scopes`,
    [context.organizationId, stateHash, verifierHash],
  );
  if (!result.rows[0])
    throw new CrmCommunicationsError(
      401,
      "OAuth state is invalid or expired.",
      "CRM_OAUTH_STATE_INVALID",
    );
  return result.rows[0];
}

export async function createSharedInbox(client, context, input = {}) {
  const result = await client.query(
    `INSERT INTO tenant.crm_shared_inboxes(organization_id,company_id,sync_account_id,name,channel,address,sla_minutes,collision_timeout_minutes,business_hours,status,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$10) RETURNING *`,
    [
      context.organizationId,
      input.companyId || context.activeCompanyId || null,
      input.syncAccountId
        ? assertId(input.syncAccountId, "Sync account")
        : null,
      text(input.name),
      text(input.channel) || "email",
      optionalEmail(input.address),
      Math.max(1, integer(input.slaMinutes, 240)),
      Math.max(1, integer(input.collisionTimeoutMinutes, 15)),
      JSON.stringify(object(input.businessHours)),
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function upsertSharedInboxMember(
  client,
  context,
  inboxId,
  input = {},
) {
  const id = assertId(inboxId, "Inbox");
  const userId = assertId(input.userId || context.userId, "Inbox member");
  const role = ["manager", "agent", "observer"].includes(text(input.memberRole))
    ? text(input.memberRole)
    : "agent";
  const result = await client.query(
    `INSERT INTO tenant.crm_shared_inbox_members(
       organization_id,inbox_id,user_id,member_role,routing_weight,is_available,created_by
     ) VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (organization_id,inbox_id,user_id) DO UPDATE SET
       member_role=EXCLUDED.member_role,routing_weight=EXCLUDED.routing_weight,
       is_available=EXCLUDED.is_available
     RETURNING *`,
    [
      context.organizationId,
      id,
      userId,
      role,
      Math.max(1, integer(input.routingWeight, 100)),
      input.isAvailable !== false,
      context.userId,
    ],
  );
  return result.rows[0];
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

async function syncAccount(client, context, id) {
  const result = await client.query(
    `SELECT * FROM tenant.crm_sync_accounts WHERE organization_id=$1 AND id=$2 AND status<>'disabled'`,
    [context.organizationId, assertId(id, "Sync account")],
  );
  if (!result.rows[0])
    throw new CrmCommunicationsError(404, "Sync account not found.");
  return result.rows[0];
}

export async function ingestMailboxDelta(
  client,
  context,
  syncAccountId,
  input = {},
) {
  const account = await syncAccount(client, context, syncAccountId);
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
       ON CONFLICT (organization_id,provider,external_thread_id) DO UPDATE SET subject=COALESCE(EXCLUDED.subject,tenant.crm_email_threads.subject),preview=EXCLUDED.preview,participant_addresses=EXCLUDED.participant_addresses,last_message_at=GREATEST(tenant.crm_email_threads.last_message_at,EXCLUDED.last_message_at),unread_count=tenant.crm_email_threads.unread_count+EXCLUDED.unread_count,updated_at=now()
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

export async function ingestCalendarDelta(
  client,
  context,
  syncAccountId,
  input = {},
) {
  const account = await syncAccount(client, context, syncAccountId);
  const provider = text(input.provider || account.provider).toLowerCase();
  const events = array(input.events).map((row) =>
    normalizeProviderCalendarEvent(provider, row),
  );
  let processed = 0;
  for (const event of events) {
    const result = await client.query(
      `INSERT INTO tenant.crm_calendar_events(organization_id,company_id,sync_account_id,provider,external_event_id,etag,title,description,starts_at,ends_at,timezone,all_day,location,organizer_email,online_meeting_url,visibility,provider_status,lead_id,opportunity_id,party_id,contact_id,metadata,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$23)
       ON CONFLICT (organization_id,provider,external_event_id) DO UPDATE SET etag=EXCLUDED.etag,title=EXCLUDED.title,description=EXCLUDED.description,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,timezone=EXCLUDED.timezone,all_day=EXCLUDED.all_day,location=EXCLUDED.location,organizer_email=EXCLUDED.organizer_email,online_meeting_url=EXCLUDED.online_meeting_url,visibility=EXCLUDED.visibility,provider_status=EXCLUDED.provider_status,metadata=EXCLUDED.metadata,updated_at=now()
       RETURNING id`,
      [
        context.organizationId,
        input.companyId ||
          account.company_id ||
          context.activeCompanyId ||
          null,
        account.id,
        provider,
        event.externalEventId,
        event.etag,
        event.title,
        event.description,
        event.startsAt,
        event.endsAt,
        event.timezone,
        event.allDay,
        event.location,
        event.organizerEmail,
        event.onlineMeetingUrl,
        event.visibility,
        event.providerStatus,
        input.leadId || null,
        input.opportunityId || null,
        input.partyId || null,
        input.contactId || null,
        JSON.stringify(event.metadata),
        context.userId,
      ],
    );
    await client.query(
      `DELETE FROM tenant.crm_calendar_attendees WHERE organization_id=$1 AND calendar_event_id=$2`,
      [context.organizationId, result.rows[0].id],
    );
    for (const attendee of event.attendees) {
      await client.query(
        `INSERT INTO tenant.crm_calendar_attendees(organization_id,calendar_event_id,email_address,display_name,attendee_type,response_status,is_organizer)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (organization_id,calendar_event_id,email_address) DO UPDATE SET display_name=EXCLUDED.display_name,attendee_type=EXCLUDED.attendee_type,response_status=EXCLUDED.response_status,is_organizer=EXCLUDED.is_organizer`,
        [
          context.organizationId,
          result.rows[0].id,
          attendee.emailAddress,
          attendee.displayName || null,
          attendee.attendeeType || "required",
          ["accepted", "declined", "tentative", "needs_action"].includes(
            attendee.responseStatus,
          )
            ? attendee.responseStatus
            : "needs_action",
          Boolean(attendee.isOrganizer),
        ],
      );
    }
    processed += 1;
  }
  await client.query(
    `UPDATE tenant.crm_sync_accounts SET calendar_cursor=$3,last_synced_at=now(),last_error=NULL,status='connected',sync_lock_until=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [
      context.organizationId,
      account.id,
      text(input.nextCursor) || account.calendar_cursor || null,
    ],
  );
  return {
    processed,
    nextCursor: text(input.nextCursor) || account.calendar_cursor || null,
  };
}

export async function claimSharedInboxThread(
  client,
  context,
  threadId,
  input = {},
) {
  const id = assertId(threadId, "Thread");
  const result = await client.query(
    `UPDATE tenant.crm_email_threads thread SET assigned_user_id=$3,claimed_at=now(),claim_expires_at=now()+COALESCE((SELECT collision_timeout_minutes FROM tenant.crm_shared_inboxes inbox WHERE inbox.organization_id=thread.organization_id AND inbox.id=thread.inbox_id),15)*interval '1 minute',updated_by=$3,updated_at=now()
     WHERE thread.organization_id=$1 AND thread.id=$2 AND (thread.assigned_user_id IS NULL OR thread.assigned_user_id=$3 OR thread.claim_expires_at<now()) RETURNING *`,
    [context.organizationId, id, input.userId || context.userId],
  );
  if (!result.rows[0])
    throw new CrmCommunicationsError(
      409,
      "Another agent currently owns this conversation.",
      "CRM_INBOX_COLLISION",
    );
  return result.rows[0];
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
     ON CONFLICT (organization_id,provider,external_thread_id) DO UPDATE SET last_message_at=now(),updated_at=now() RETURNING *`,
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
    `INSERT INTO tenant.crm_communications(organization_id,channel,direction,lead_id,opportunity_id,party_id,contact_id,provider,provider_message_id,subject,body,from_address,to_addresses,status,occurred_at,metadata,created_by,updated_by)
     VALUES($1,'email','outbound',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'queued',now(),$12,$13,$13) RETURNING *`,
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
      context.userId,
    ],
  );
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
  await client.query(
    `INSERT INTO tenant.crm_outbox_events(organization_id,event_type,entity_type,entity_id,payload,status) VALUES($1,'crm.communication.queued','communication',$2,$3,'pending')`,
    [
      context.organizationId,
      communication.rows[0].id,
      JSON.stringify({
        provider: text(input.provider) || "manual",
        syncAccountId: input.syncAccountId || null,
        emailMessageId: message.rows[0].id,
      }),
    ],
  );
  return message.rows[0];
}

export async function getMeetingAvailability(
  client,
  context,
  meetingLinkId,
  date,
  input = {},
) {
  const link = await client.query(
    `SELECT * FROM tenant.crm_meeting_links WHERE organization_id=$1 AND id=$2 AND status='active'`,
    [context.organizationId, assertId(meetingLinkId, "Meeting link")],
  );
  if (!link.rows[0])
    throw new CrmCommunicationsError(404, "Meeting link not found.");
  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;
  const busy = await client.query(
    `SELECT starts_at AS start,ends_at AS end FROM tenant.crm_calendar_events WHERE organization_id=$1 AND starts_at<$3 AND ends_at>$2 AND provider_status<>'cancelled' UNION ALL SELECT starts_at AS start,ends_at AS end FROM tenant.crm_meeting_bookings WHERE organization_id=$1 AND starts_at<$3 AND ends_at>$2 AND status='confirmed'`,
    [context.organizationId, dayStart, dayEnd],
  );
  return calculateMeetingSlots({
    date,
    durationMinutes: link.rows[0].duration_minutes,
    bufferBeforeMinutes: link.rows[0].buffer_before_minutes,
    bufferAfterMinutes: link.rows[0].buffer_after_minutes,
    availability: link.rows[0].availability,
    busy: busy.rows,
    minimumNoticeMinutes: link.rows[0].minimum_notice_minutes,
    now: input.now ? new Date(input.now) : new Date(),
  });
}

export async function bookMeeting(client, context, meetingLinkId, input = {}) {
  const link = await client.query(
    `SELECT * FROM tenant.crm_meeting_links WHERE organization_id=$1 AND id=$2 AND status='active'`,
    [context.organizationId, assertId(meetingLinkId, "Meeting link")],
  );
  if (!link.rows[0])
    throw new CrmCommunicationsError(404, "Meeting link not found.");
  const startsAt = new Date(text(input.startsAt));
  const endsAt = new Date(
    startsAt.getTime() + Number(link.rows[0].duration_minutes) * 60000,
  );
  if (Number.isNaN(startsAt.getTime()))
    throw new CrmCommunicationsError(400, "Meeting start time is invalid.");
  const slots = await getMeetingAvailability(
    client,
    context,
    meetingLinkId,
    startsAt.toISOString().slice(0, 10),
    { now: input.now },
  );
  if (!slots.some((slot) => slot.startsAt === startsAt.toISOString()))
    throw new CrmCommunicationsError(
      409,
      "Selected meeting time is no longer available.",
      "CRM_MEETING_SLOT_UNAVAILABLE",
    );
  const guestEmail = normalizeEmailAddress(input.guestEmail);
  const booking = await client.query(
    `INSERT INTO tenant.crm_meeting_bookings(organization_id,company_id,meeting_link_id,host_user_id,guest_name,guest_email,guest_timezone,starts_at,ends_at,status,notes)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed',$10) RETURNING *`,
    [
      context.organizationId,
      link.rows[0].company_id || context.activeCompanyId || null,
      link.rows[0].id,
      link.rows[0].owner_user_id,
      text(input.guestName),
      guestEmail,
      text(input.guestTimezone) || "UTC",
      startsAt.toISOString(),
      endsAt.toISOString(),
      text(input.notes) || null,
    ],
  );
  const event = await client.query(
    `INSERT INTO tenant.crm_calendar_events(organization_id,company_id,provider,external_event_id,title,starts_at,ends_at,timezone,location,organizer_email,online_meeting_url,visibility,provider_status,meeting_booking_id,metadata,created_by,updated_by)
     VALUES($1,$2,'vercentlabs',$3,$4,$5,$6,$7,$8,$9,$10,'default','confirmed',$11,$12,$13,$13) RETURNING *`,
    [
      context.organizationId,
      link.rows[0].company_id || context.activeCompanyId || null,
      `booking-${booking.rows[0].id}`,
      link.rows[0].name,
      startsAt.toISOString(),
      endsAt.toISOString(),
      link.rows[0].timezone,
      link.rows[0].location_template || null,
      null,
      null,
      booking.rows[0].id,
      JSON.stringify({ guestEmail }),
      context.userId,
    ],
  );
  await client.query(
    `UPDATE tenant.crm_meeting_bookings SET calendar_event_id=$3,updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, booking.rows[0].id, event.rows[0].id],
  );
  await client.query(
    `INSERT INTO tenant.crm_calendar_attendees(organization_id,calendar_event_id,email_address,display_name,response_status) VALUES($1,$2,$3,$4,'accepted')`,
    [
      context.organizationId,
      event.rows[0].id,
      guestEmail,
      text(input.guestName),
    ],
  );
  await client.query(
    `INSERT INTO tenant.crm_outbox_events(organization_id,event_type,entity_type,entity_id,payload,status)
     VALUES($1,'crm.meeting.booked','meeting_booking',$2,$3,'pending')`,
    [
      context.organizationId,
      booking.rows[0].id,
      JSON.stringify({
        guestEmail,
        startsAt: startsAt.toISOString(),
        meetingLinkId: link.rows[0].id,
      }),
    ],
  );
  return { ...booking.rows[0], calendar_event_id: event.rows[0].id };
}

export function resolveProviderCredential(
  referenceValue,
  environment = process.env,
) {
  const reference = text(referenceValue);
  const variable = reference.startsWith("env:")
    ? reference.slice(4)
    : reference;
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(variable)) {
    throw new CrmCommunicationsError(
      503,
      "Provider credential reference must point to an environment-backed secret.",
      "CRM_PROVIDER_SECRET_REFERENCE_INVALID",
    );
  }
  const raw = text(environment[variable]);
  if (!raw) {
    throw new CrmCommunicationsError(
      503,
      `Provider credential ${variable} is unavailable.`,
      "CRM_PROVIDER_SECRET_MISSING",
    );
  }
  let credential;
  try {
    credential = JSON.parse(raw);
  } catch {
    throw new CrmCommunicationsError(
      503,
      "Provider credential JSON is invalid.",
      "CRM_PROVIDER_SECRET_INVALID",
    );
  }
  if (!text(credential.accessToken)) {
    throw new CrmCommunicationsError(
      503,
      "Provider access token is missing.",
      "CRM_PROVIDER_ACCESS_TOKEN_MISSING",
    );
  }
  return credential;
}

async function providerJson(fetchImpl, url, accessToken) {
  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new CrmCommunicationsError(
      response.status >= 500 ? 503 : 502,
      `Provider request failed (${response.status}). ${body.slice(0, 240)}`,
      "CRM_PROVIDER_REQUEST_FAILED",
    );
  }
  return response.json();
}

export async function fetchProviderMailboxDelta(account, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new CrmCommunicationsError(503, "Fetch is unavailable.");
  }
  const credential =
    options.credential ||
    resolveProviderCredential(
      account.credential_reference,
      options.environment,
    );
  const provider = text(account.provider).toLowerCase();
  if (provider === "gmail") {
    const messages = [];
    let nextCursor = account.sync_cursor || null;
    if (account.sync_cursor) {
      const historyUrl = new URL(
        "https://gmail.googleapis.com/gmail/v1/users/me/history",
      );
      historyUrl.searchParams.set(
        "startHistoryId",
        String(account.sync_cursor),
      );
      historyUrl.searchParams.set("historyTypes", "messageAdded");
      historyUrl.searchParams.set("maxResults", "100");
      const page = await providerJson(
        fetchImpl,
        historyUrl.toString(),
        credential.accessToken,
      );
      const ids = [
        ...new Set(
          array(page.history)
            .flatMap((row) => array(row?.messagesAdded))
            .map((row) => text(row?.message?.id))
            .filter(Boolean),
        ),
      ];
      for (const id of ids) {
        messages.push(
          await providerJson(
            fetchImpl,
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
            credential.accessToken,
          ),
        );
      }
      nextCursor = text(page.historyId) || nextCursor;
    } else {
      const page = await providerJson(
        fetchImpl,
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50",
        credential.accessToken,
      );
      for (const row of array(page.messages)) {
        const id = text(row?.id);
        if (!id) continue;
        messages.push(
          await providerJson(
            fetchImpl,
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
            credential.accessToken,
          ),
        );
      }
      const profile = await providerJson(
        fetchImpl,
        "https://gmail.googleapis.com/gmail/v1/users/me/profile",
        credential.accessToken,
      );
      nextCursor = text(profile.historyId) || null;
    }
    return { provider, messages, nextCursor };
  }
  if (provider === "microsoft365") {
    const url =
      text(account.sync_cursor) ||
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$top=50&$select=id,conversationId,internetMessageId,subject,body,bodyPreview,receivedDateTime,sentDateTime,isRead,isDraft,from,sender,toRecipients,ccRecipients,bccRecipients,replyTo,categories,changeKey,parentFolderId";
    const page = await providerJson(fetchImpl, url, credential.accessToken);
    return {
      provider,
      messages: array(page.value).filter((row) => !row?.["@removed"]),
      nextCursor:
        text(page["@odata.deltaLink"] || page["@odata.nextLink"]) ||
        account.sync_cursor ||
        null,
    };
  }
  throw new CrmCommunicationsError(
    400,
    "Mailbox synchronization supports Gmail and Microsoft 365.",
    "CRM_PROVIDER_UNSUPPORTED",
  );
}

export async function fetchProviderCalendarDelta(account, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new CrmCommunicationsError(503, "Fetch is unavailable.");
  }
  const credential =
    options.credential ||
    resolveProviderCredential(
      account.credential_reference,
      options.environment,
    );
  const provider = text(account.provider).toLowerCase();
  if (provider === "gmail") {
    const url = new URL(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    );
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("maxResults", "250");
    if (account.calendar_cursor) {
      url.searchParams.set("syncToken", String(account.calendar_cursor));
    } else {
      url.searchParams.set("timeMin", new Date().toISOString());
    }
    const page = await providerJson(
      fetchImpl,
      url.toString(),
      credential.accessToken,
    );
    return {
      provider,
      events: array(page.items),
      nextCursor:
        text(page.nextSyncToken || page.nextPageToken) ||
        account.calendar_cursor ||
        null,
    };
  }
  if (provider === "microsoft365") {
    const start = new Date();
    const end = new Date(start.getTime() + 180 * 86400000);
    const url =
      text(account.calendar_cursor) ||
      `https://graph.microsoft.com/v1.0/me/calendarView/delta?startDateTime=${encodeURIComponent(start.toISOString())}&endDateTime=${encodeURIComponent(end.toISOString())}`;
    const page = await providerJson(fetchImpl, url, credential.accessToken);
    return {
      provider,
      events: array(page.value).filter((row) => !row?.["@removed"]),
      nextCursor:
        text(page["@odata.deltaLink"] || page["@odata.nextLink"]) ||
        account.calendar_cursor ||
        null,
    };
  }
  throw new CrmCommunicationsError(
    400,
    "Calendar synchronization supports Gmail and Microsoft 365.",
    "CRM_PROVIDER_UNSUPPORTED",
  );
}

export async function synchronizeProviderAccount(
  client,
  context,
  syncAccountId,
  input = {},
) {
  const account = await syncAccount(client, context, syncAccountId);
  const lock = await client.query(
    `UPDATE tenant.crm_sync_accounts
     SET status='syncing',sync_lock_until=now()+interval '10 minutes',last_error=NULL,updated_at=now()
     WHERE organization_id=$1 AND id=$2 AND (sync_lock_until IS NULL OR sync_lock_until<now())
     RETURNING *`,
    [context.organizationId, account.id],
  );
  if (!lock.rows[0]) {
    throw new CrmCommunicationsError(
      409,
      "A provider synchronization is already running.",
      "CRM_PROVIDER_SYNC_LOCKED",
    );
  }
  const syncType = input.syncType === "calendar" ? "calendar" : "mailbox";
  const job = await client.query(
    `INSERT INTO tenant.crm_provider_sync_jobs(organization_id,sync_account_id,sync_type,cursor_before,status,attempted_count,started_at,metadata)
     VALUES($1,$2,$3,$4,'processing',1,now(),$5) RETURNING *`,
    [
      context.organizationId,
      account.id,
      syncType,
      syncType === "calendar" ? account.calendar_cursor : account.sync_cursor,
      JSON.stringify({ requestedBy: context.userId }),
    ],
  );
  try {
    const page =
      syncType === "calendar"
        ? await fetchProviderCalendarDelta(account, input)
        : await fetchProviderMailboxDelta(account, input);
    const result =
      syncType === "calendar"
        ? await ingestCalendarDelta(client, context, account.id, page)
        : await ingestMailboxDelta(client, context, account.id, page);
    await client.query(
      `UPDATE tenant.crm_provider_sync_jobs SET cursor_after=$3,status='completed',processed_count=$4,completed_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [
        context.organizationId,
        job.rows[0].id,
        page.nextCursor || null,
        Number(result.processed || result.inserted || 0),
      ],
    );
    return { jobId: job.rows[0].id, ...result };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Provider sync failed.";
    await client.query(
      `UPDATE tenant.crm_provider_sync_jobs SET status='failed',failure_count=1,last_error=$3,next_attempt_at=now()+interval '5 minutes',completed_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, job.rows[0].id, message],
    );
    await client.query(
      `UPDATE tenant.crm_sync_accounts SET status='error',last_error=$3,sync_lock_until=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, account.id, message],
    );
    throw error;
  }
}

export async function cancelMeetingBooking(
  client,
  context,
  bookingId,
  reason = null,
) {
  const result = await client.query(
    `UPDATE tenant.crm_meeting_bookings
     SET status='cancelled',cancelled_at=now(),cancellation_reason=$3,updated_at=now()
     WHERE organization_id=$1 AND id=$2 AND status='confirmed'
     RETURNING *`,
    [
      context.organizationId,
      assertId(bookingId, "Meeting booking"),
      text(reason) || null,
    ],
  );
  if (!result.rows[0]) {
    throw new CrmCommunicationsError(
      409,
      "Meeting booking cannot be cancelled.",
    );
  }
  await client.query(
    `UPDATE tenant.crm_calendar_events SET provider_status='cancelled',updated_at=now()
     WHERE organization_id=$1 AND meeting_booking_id=$2`,
    [context.organizationId, result.rows[0].id],
  );
  return result.rows[0];
}

export async function rescheduleMeetingBooking(
  client,
  context,
  bookingId,
  input = {},
) {
  const id = assertId(bookingId, "Meeting booking");
  const current = await client.query(
    `SELECT booking.*,link.duration_minutes
     FROM tenant.crm_meeting_bookings booking
     JOIN tenant.crm_meeting_links link
       ON link.organization_id=booking.organization_id AND link.id=booking.meeting_link_id
     WHERE booking.organization_id=$1 AND booking.id=$2 AND booking.status='confirmed'`,
    [context.organizationId, id],
  );
  if (!current.rows[0]) {
    throw new CrmCommunicationsError(404, "Meeting booking not found.");
  }
  const startsAt = new Date(text(input.startsAt));
  if (Number.isNaN(startsAt.getTime())) {
    throw new CrmCommunicationsError(400, "Meeting start time is invalid.");
  }
  const slots = await getMeetingAvailability(
    client,
    context,
    current.rows[0].meeting_link_id,
    startsAt.toISOString().slice(0, 10),
    { now: input.now },
  );
  if (!slots.some((slot) => slot.startsAt === startsAt.toISOString())) {
    throw new CrmCommunicationsError(
      409,
      "Selected meeting time is no longer available.",
      "CRM_MEETING_SLOT_UNAVAILABLE",
    );
  }
  const endsAt = new Date(
    startsAt.getTime() + Number(current.rows[0].duration_minutes) * 60000,
  );
  const result = await client.query(
    `UPDATE tenant.crm_meeting_bookings
     SET starts_at=$3,ends_at=$4,guest_timezone=$5,updated_at=now()
     WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [
      context.organizationId,
      id,
      startsAt.toISOString(),
      endsAt.toISOString(),
      text(input.guestTimezone) || current.rows[0].guest_timezone,
    ],
  );
  await client.query(
    `UPDATE tenant.crm_calendar_events
     SET starts_at=$3,ends_at=$4,updated_at=now()
     WHERE organization_id=$1 AND meeting_booking_id=$2`,
    [context.organizationId, id, startsAt.toISOString(), endsAt.toISOString()],
  );
  return result.rows[0];
}

export async function getCommunicationTimeline(client, context, input = {}) {
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
  const result = await client.query(
    `SELECT communication.*,message.id AS email_message_id,message.status AS email_status,thread.id AS thread_id,thread.assigned_user_id,thread.first_response_due_at,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('type',event.event_type,'occurredAt',event.occurred_at,'url',event.url) ORDER BY event.occurred_at) FROM tenant.crm_email_events event WHERE event.organization_id=communication.organization_id AND event.message_id=message.id),'[]'::jsonb) AS engagement_events
     FROM tenant.crm_communications communication
     LEFT JOIN tenant.crm_email_messages message ON message.organization_id=communication.organization_id AND message.communication_id=communication.id
     LEFT JOIN tenant.crm_email_threads thread ON thread.organization_id=message.organization_id AND thread.id=message.thread_id
     WHERE ${clauses.join(" AND ")} ORDER BY communication.occurred_at DESC LIMIT 500`,
    parameters,
  );
  return result.rows;
}

export async function getCommunicationsDashboard(client, context) {
  const [
    summary,
    inboxes,
    threads,
    upcoming,
    syncAccounts,
    suppressions,
    signatures,
  ] = await Promise.all([
    client.query(
      `SELECT count(*) FILTER (WHERE status='open')::int AS open_threads,count(*) FILTER (WHERE status='open' AND first_response_due_at<now() AND first_responded_at IS NULL)::int AS overdue_threads,count(*) FILTER (WHERE unread_count>0)::int AS unread_threads FROM tenant.crm_email_threads WHERE organization_id=$1`,
      [context.organizationId],
    ),
    client.query(
      `SELECT inbox.*,count(thread.id)::int AS open_threads,count(thread.id) FILTER (WHERE thread.first_response_due_at<now() AND thread.first_responded_at IS NULL)::int AS overdue_threads FROM tenant.crm_shared_inboxes inbox LEFT JOIN tenant.crm_email_threads thread ON thread.organization_id=inbox.organization_id AND thread.inbox_id=inbox.id AND thread.status='open' WHERE inbox.organization_id=$1 GROUP BY inbox.id ORDER BY inbox.name`,
      [context.organizationId],
    ),
    client.query(
      `SELECT thread.*,inbox.name AS inbox_name FROM tenant.crm_email_threads thread LEFT JOIN tenant.crm_shared_inboxes inbox ON inbox.organization_id=thread.organization_id AND inbox.id=thread.inbox_id WHERE thread.organization_id=$1 AND thread.status IN ('open','pending') ORDER BY CASE thread.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,thread.first_response_due_at NULLS LAST,thread.last_message_at DESC LIMIT 50`,
      [context.organizationId],
    ),
    client.query(
      `SELECT booking.*,link.name AS meeting_name FROM tenant.crm_meeting_bookings booking JOIN tenant.crm_meeting_links link ON link.organization_id=booking.organization_id AND link.id=booking.meeting_link_id WHERE booking.organization_id=$1 AND booking.status='confirmed' AND booking.starts_at>=now() ORDER BY booking.starts_at LIMIT 20`,
      [context.organizationId],
    ),
    client.query(
      `SELECT id,provider,display_name,email_address,status,last_synced_at,last_error,webhook_expires_at FROM tenant.crm_sync_accounts WHERE organization_id=$1 ORDER BY updated_at DESC`,
      [context.organizationId],
    ),
    client.query(
      `SELECT count(*)::int AS active FROM tenant.crm_email_suppressions WHERE organization_id=$1 AND status='active' AND (expires_at IS NULL OR expires_at>now())`,
      [context.organizationId],
    ),
    client.query(
      `SELECT id,name,is_default,status FROM tenant.crm_email_signatures WHERE organization_id=$1 AND status='active' AND (user_id=$2 OR user_id IS NULL) ORDER BY is_default DESC,name`,
      [context.organizationId, context.userId],
    ),
  ]);
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

export async function recordCrmCommunicationsAcceptance(
  client,
  context,
  input = {},
) {
  const capabilityId = text(input.capabilityId);
  if (!CRM_COMMUNICATION_CAPABILITY_IDS.includes(capabilityId))
    throw new CrmCommunicationsError(
      400,
      "CRM communications capability is invalid.",
    );
  const evidence = object(input.evidence);
  const result = await client.query(
    `INSERT INTO tenant.crm_communication_acceptance_runs(organization_id,capability_id,status,commit_sha,evidence,evidence_hash,provider_acceptance,recorded_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (organization_id,capability_id,commit_sha) DO NOTHING RETURNING *`,
    [
      context.organizationId,
      capabilityId,
      text(input.status) || "passed",
      text(input.commitSha) || "crm04-local",
      JSON.stringify(evidence),
      crmCommunicationsHash(evidence),
      text(input.providerAcceptance) || "sandbox",
      context.userId,
    ],
  );
  return result.rows[0] || null;
}

export async function getCrmCommunicationsReadiness(client, context) {
  const result = await client.query(
    `SELECT capability_id,status,provider_acceptance,recorded_at,commit_sha,evidence_hash FROM tenant.crm_communication_acceptance_runs WHERE organization_id=$1 ORDER BY recorded_at DESC`,
    [context.organizationId],
  );
  const latest = new Map();
  for (const row of result.rows)
    if (!latest.has(row.capability_id)) latest.set(row.capability_id, row);
  const checks = CRM_COMMUNICATION_CAPABILITY_IDS.map((id) => ({
    id,
    status: latest.get(id)?.status || "missing",
    providerAcceptance: latest.get(id)?.provider_acceptance || "missing",
  }));
  const passed = checks.filter((check) => check.status === "passed").length;
  return {
    readiness: passed === checks.length ? "ready" : "blocked",
    score: Math.round((passed / checks.length) * 100),
    passed,
    total: checks.length,
    checks,
  };
}
