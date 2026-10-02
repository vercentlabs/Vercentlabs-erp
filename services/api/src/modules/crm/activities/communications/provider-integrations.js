// Gmail and Microsoft 365 integration shared by email (F018) and calendar
// (F014): message/event normalisation, webhook signature verification,
// OAuth state, credential resolution, the trusted-host HTTP wrapper,
// mailbox/calendar delta fetch and outbound calendar push, and the
// sync-account lookup. Security-sensitive code here is moved verbatim.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CrmCommunicationsError, assertId } from "./communications-error.js";
import { crmCommunicationsHash } from "./content-hash.js";
import { optionalEmail } from "./email-address.js";

const text = (value) => String(value ?? "").trim();
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const array = (value) => (Array.isArray(value) ? value : []);

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

export async function loadSyncAccount(client, context, id) {
  const result = await client.query(
    `SELECT * FROM tenant.crm_sync_accounts WHERE organization_id=$1 AND id=$2 AND status<>'disabled'`,
    [context.organizationId, assertId(id, "Sync account")],
  );
  if (!result.rows[0])
    throw new CrmCommunicationsError(404, "Sync account not found.");
  return result.rows[0];
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
  return providerRequest(fetchImpl, url, accessToken, {});
}

// General provider HTTP helper (GET/POST/PATCH/DELETE) shared by the
// inbound-pull functions above (fetchProviderMailboxDelta/CalendarDelta,
// via providerJson) and the outbound calendar push below —
// pushProviderCalendarEvent — rather than a second, near-duplicate fetch
// wrapper.
// Provider hosts a bearer token may ever be sent to. Delta cursors are stored
// URLs (Microsoft Graph nextLink/deltaLink) and the mailbox cursor is editable
// through the sync-accounts resource, so a URL is checked before the token
// goes anywhere: a tampered cursor cannot exfiltrate the user's token.
const PROVIDER_HOSTS = new Set(["gmail.googleapis.com", "www.googleapis.com", "graph.microsoft.com"]);
export const PROVIDER_REQUEST_TIMEOUT_MS = 20_000;

export function assertTrustedProviderUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new CrmCommunicationsError(400, "Provider address is invalid.", "CRM_PROVIDER_URL_UNTRUSTED");
  }
  if (url.protocol !== "https:" || !PROVIDER_HOSTS.has(url.hostname) || url.username || url.password || url.port)
    throw new CrmCommunicationsError(400, "Provider address is not an allowed provider endpoint.", "CRM_PROVIDER_URL_UNTRUSTED");
  return url.toString();
}

async function providerRequest(fetchImpl, url, accessToken, { method = "GET", body, allowNotFound = false, timeoutMs = PROVIDER_REQUEST_TIMEOUT_MS } = {}) {
  const target = assertTrustedProviderUrl(url);
  let response;
  try {
    response = await fetchImpl(target, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // A hung or unreachable provider is a retryable 503, never a stuck worker.
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    const failure = new CrmCommunicationsError(503, timedOut ? "Provider request timed out." : "Provider is unreachable.", timedOut ? "CRM_PROVIDER_TIMEOUT" : "CRM_PROVIDER_UNREACHABLE");
    failure.providerStatus = null;
    throw failure;
  }
  // Cancelling an event the provider has already deleted (a prior attempt
  // succeeded but the response was lost, or the guest/host deleted it
  // directly in Gmail/Outlook) must be idempotent success, not a retry
  // loop — 404/410 on a DELETE means "already gone," which is exactly the
  // end state a cancel is trying to reach.
  if (allowNotFound && (response.status === 404 || response.status === 410)) return {};
  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    const failure = new CrmCommunicationsError(
      response.status >= 500 || response.status === 429 ? 503 : 502,
      `Provider request failed (${response.status}). ${responseBody.slice(0, 240)}`,
      "CRM_PROVIDER_REQUEST_FAILED",
    );
    failure.providerStatus = response.status;
    throw failure;
  }
  if (response.status === 204) return {};
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
    // Cursor forms: "page:<pageToken>|<timeMin>" continues a multi-page
    // listing with the same parameters; anything else is a syncToken. (A
    // nextPageToken used to be stored and replayed as a syncToken, which
    // Google rejects, so every account with more than one page broke.)
    const cursor = text(account.calendar_cursor);
    if (cursor.startsWith("page:")) {
      const [pageToken, timeMin] = cursor.slice(5).split("|");
      url.searchParams.set("pageToken", pageToken);
      if (timeMin) url.searchParams.set("timeMin", timeMin);
    } else if (cursor) {
      url.searchParams.set("syncToken", cursor);
    } else {
      url.searchParams.set("timeMin", new Date().toISOString());
    }
    let page;
    try {
      page = await providerJson(fetchImpl, url.toString(), credential.accessToken);
    } catch (error) {
      // 410 Gone = Google expired the sync token: restart from a full window
      // instead of failing every future sync.
      if (error?.providerStatus !== 410 || !account.calendar_cursor) throw error;
      return fetchProviderCalendarDelta({ ...account, calendar_cursor: null }, options);
    }
    return {
      provider,
      events: array(page.items),
      nextCursor: page.nextSyncToken
        ? text(page.nextSyncToken)
        : page.nextPageToken
          ? `page:${text(page.nextPageToken)}|${url.searchParams.get("timeMin") || ""}`
          : account.calendar_cursor || null,
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
      // Deleted in Outlook: the delta carries only the id. Previously these
      // were dropped, so a meeting deleted in the provider stayed busy forever.
      removedEventIds: array(page.value).filter((row) => row?.["@removed"] && text(row?.id)).map((row) => text(row.id)),
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

// Outbound calendar sync — the symmetric counterpart of
// fetchProviderCalendarDelta above: create/update/cancel one event on the
// host's connected Gmail/Microsoft365 calendar, so a CRM-created Meeting is
// really synchronized rather than only stored internally. Deliberately a plain,
// injectable-fetchImpl function (same shape as fetchProviderCalendarDelta)
// so it is testable with a deterministic mock adapter, never a paid
// external account — and deliberately NOT called from inside a DB
// transaction (see the worker handler that calls this): real network I/O
// must never happen while holding a tenant-transaction lock open.
export async function pushProviderCalendarEvent(account, event, action, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new CrmCommunicationsError(503, "Fetch is unavailable.");
  }
  const credential =
    options.credential ||
    resolveProviderCredential(account.credential_reference, options.environment);
  const provider = text(account.provider).toLowerCase();
  const attendees = array(event.attendees).map((attendee) => ({
    email: text(attendee.email),
    displayName: text(attendee.name) || undefined,
  }));

  if (provider === "gmail") {
    const base = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
    if (action === "cancel") {
      if (!event.externalEventId) return { externalEventId: null, etag: null, providerStatus: "cancelled" };
      await providerRequest(fetchImpl, `${base}/${encodeURIComponent(event.externalEventId)}`, credential.accessToken, { method: "DELETE", allowNotFound: true });
      return { externalEventId: null, etag: null, providerStatus: "cancelled" };
    }
    const body = {
      summary: event.title,
      description: event.description || undefined,
      location: event.location || undefined,
      start: { dateTime: event.startsAt, timeZone: event.timezone || "UTC" },
      end: { dateTime: event.endsAt, timeZone: event.timezone || "UTC" },
      attendees: attendees.length ? attendees : undefined,
      conferenceData: event.onlineMeetingUrl ? { entryPoints: [{ entryPointType: "video", uri: event.onlineMeetingUrl }] } : undefined,
    };
    const result = event.externalEventId
      ? await providerRequest(fetchImpl, `${base}/${encodeURIComponent(event.externalEventId)}`, credential.accessToken, { method: "PATCH", body })
      : await providerRequest(fetchImpl, base, credential.accessToken, { method: "POST", body });
    return { externalEventId: text(result.id), etag: text(result.etag) || null, providerStatus: text(result.status) || "confirmed" };
  }

  if (provider === "microsoft365") {
    const base = "https://graph.microsoft.com/v1.0/me/events";
    if (action === "cancel") {
      if (!event.externalEventId) return { externalEventId: null, etag: null, providerStatus: "cancelled" };
      await providerRequest(fetchImpl, `${base}/${encodeURIComponent(event.externalEventId)}`, credential.accessToken, { method: "DELETE", allowNotFound: true });
      return { externalEventId: null, etag: null, providerStatus: "cancelled" };
    }
    const body = {
      subject: event.title,
      body: event.description ? { contentType: "text", content: event.description } : undefined,
      location: event.location ? { displayName: event.location } : undefined,
      start: { dateTime: event.startsAt, timeZone: "UTC" },
      end: { dateTime: event.endsAt, timeZone: "UTC" },
      attendees: attendees.length
        ? attendees.map((attendee) => ({ emailAddress: { address: attendee.email, name: attendee.displayName }, type: "required" }))
        : undefined,
      isOnlineMeeting: Boolean(event.onlineMeetingUrl) || undefined,
    };
    const result = event.externalEventId
      ? await providerRequest(fetchImpl, `${base}/${encodeURIComponent(event.externalEventId)}`, credential.accessToken, { method: "PATCH", body })
      : await providerRequest(fetchImpl, base, credential.accessToken, { method: "POST", body });
    return { externalEventId: text(result.id), etag: text(result["@odata.etag"]) || null, providerStatus: "confirmed" };
  }

  throw new CrmCommunicationsError(
    400,
    "Calendar push supports Gmail and Microsoft 365.",
    "CRM_PROVIDER_UNSUPPORTED",
  );
}
