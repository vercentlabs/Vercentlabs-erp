// Lead connectors (CRM plan 3.3): IndiaMART, JustDial, TradeIndia, Meta and Google lead forms bring their leads into CRM.
//
// A connector is set up in CRM › Setup › Lead connectors with its provider, the source and owner its leads get, and its credentials
// (encrypted; shown back only as "set"). A push provider gets a webhook address whose key is shown once. Every provider lead goes through
// createLead — validation, duplicate checks, assignment rules and history, as a lead typed in — and is recorded once by the provider's
// lead id: a lead read twice, or re-sent, is never a second lead. A person the CRM already has is not a second lead either: the
// enquiry is logged on their lead or contact and its owner is told (as for a repeat website enquiry).
import { withConsentSource } from "../data-management/consent.js";
import { createHash, randomBytes } from "node:crypto";

import { setTenantContext } from "@vercentlabs/database";

import { decryptSecret, encryptSecret } from "../../../core/platform/secrets/index.js";
import { CrmError } from "../data-management/errors.js";
import { recordRepeatEnquiry } from "../leads/capture.js";
import { LEAD_PERMISSIONS } from "../leads/constants.js";
import { createLead } from "../leads/records.js";
import { LEAD_PROVIDERS, providerOf } from "./providers.js";

export const CONNECTOR_PERMISSION = "crm.capture.manage";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const text = (value) => String(value ?? "").trim();
const invalid = (field, message) => new CrmError(400, message, "CRM_CONNECTOR_VALIDATION", { issues: [{ field, message }] });
// How far back a new pull connector reads on its first run.
const FIRST_READ_DAYS = 2;

function requireManage(context) {
  if (context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(CONNECTOR_PERMISSION)) return;
  throw new CrmError(403, "You do not have permission to manage lead connectors.", "PERMISSION_DENIED");
}

const SELECT = `SELECT connector.*, source.name AS source_name, owner.full_name AS owner_name,
                       (SELECT count(*)::int FROM tenant.crm_lead_connector_events event WHERE event.organization_id = connector.organization_id AND event.connector_id = connector.id AND event.status = 'created') AS lead_count
                  FROM tenant.crm_lead_connectors connector
                  LEFT JOIN tenant.crm_lead_sources source ON source.organization_id = connector.organization_id AND source.id = connector.source_id
                  LEFT JOIN users owner ON owner.id = connector.owner_user_id`;

function toConnector(row, credentialKeys = []) {
  const provider = LEAD_PROVIDERS[row.provider];
  return {
    id: row.id, provider: row.provider, providerLabel: provider?.label ?? row.provider, name: row.name, status: row.status,
    pull: Boolean(provider?.pull), push: Boolean(provider?.push),
    sourceId: row.source_id, sourceName: row.source_name ?? null, ownerUserId: row.owner_user_id, ownerName: row.owner_name ?? null,
    credentialsSet: credentialKeys, webhookKeyPrefix: row.webhook_key_prefix ?? null, pollIntervalMinutes: row.poll_interval_minutes,
    lastPolledAt: row.last_polled_at, polledUntil: row.polled_until, lastReceivedAt: row.last_received_at, receivedCount: row.received_count,
    leadCount: row.lead_count ?? 0, lastError: row.last_error ?? null, lastErrorAt: row.last_error_at ?? null, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function credentialsOf(row, env) {
  if (!row.encrypted_credentials) return {};
  return (await decryptSecret(row.encrypted_credentials, env)) ?? {};
}

async function loadRow(client, context, connectorId) {
  if (!UUID.test(String(connectorId ?? ""))) throw new CrmError(404, "Lead connector not found.", "CRM_CONNECTOR_NOT_FOUND");
  const row = (await client.query(`${SELECT} WHERE connector.organization_id = $1 AND connector.id = $2`, [context.organizationId, connectorId])).rows[0];
  if (!row) throw new CrmError(404, "Lead connector not found.", "CRM_CONNECTOR_NOT_FOUND");
  return row;
}

export function listLeadProviders() {
  return Object.entries(LEAD_PROVIDERS).map(([key, provider]) => ({
    key, label: provider.label, pull: provider.pull, push: provider.push,
    credentials: provider.credentials.map(({ key: field, label, help, generated }) => ({ key: field, label, help: help ?? null, generated: Boolean(generated) })),
  }));
}

export async function listLeadConnectors(client, context, { env = process.env } = {}) {
  requireManage(context);
  const { rows } = await client.query(`${SELECT} WHERE connector.organization_id = $1 ORDER BY connector.status, lower(connector.name)`, [context.organizationId]);
  const out = [];
  for (const row of rows) out.push(toConnector(row, Object.keys(await credentialsOf(row, env)).filter((key) => (LEAD_PROVIDERS[row.provider]?.credentials ?? []).some((field) => field.key === key))));
  return out;
}

export async function getLeadConnector(client, context, connectorId, { env = process.env } = {}) {
  requireManage(context);
  const row = await loadRow(client, context, connectorId);
  return toConnector(row, Object.keys(await credentialsOf(row, env)));
}

// The provider's own lead source, created the first time it is needed.
async function providerSource(client, context, provider) {
  const found = (await client.query("SELECT id FROM tenant.crm_lead_sources WHERE organization_id = $1 AND code = $2", [context.organizationId, provider.sourceCode])).rows[0];
  if (found) return found.id;
  return (await client.query(
    `INSERT INTO tenant.crm_lead_sources (organization_id, code, name, channel, is_system, sort_order, created_by, updated_by)
     VALUES ($1, $2, $3, 'other', false, 900, $4, $4) ON CONFLICT DO NOTHING RETURNING id`,
    [context.organizationId, provider.sourceCode, provider.sourceName, context.userId ?? null])).rows[0]?.id
    ?? (await client.query("SELECT id FROM tenant.crm_lead_sources WHERE organization_id = $1 AND code = $2", [context.organizationId, provider.sourceCode])).rows[0]?.id ?? null;
}

async function cleanCommon(client, context, input, next) {
  if (input.name !== undefined) {
    next.name = text(input.name).slice(0, 120);
    if (!next.name) throw invalid("name", "Name the connector.");
  }
  if (input.sourceId !== undefined) {
    next.sourceId = text(input.sourceId) || null;
    if (next.sourceId && !(await client.query("SELECT 1 FROM tenant.crm_lead_sources WHERE organization_id = $1 AND id = $2 AND status = 'active'", [context.organizationId, next.sourceId])).rows[0])
      throw invalid("sourceId", "Choose an active lead source.");
  }
  if (input.ownerUserId !== undefined) {
    next.ownerUserId = text(input.ownerUserId) || null;
    if (next.ownerUserId && !(await client.query("SELECT 1 FROM organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'", [context.organizationId, next.ownerUserId])).rows[0])
      throw invalid("ownerUserId", "Choose an active member as the owner.");
  }
  if (input.pollIntervalMinutes !== undefined) {
    next.pollIntervalMinutes = Number(input.pollIntervalMinutes);
    if (!Number.isInteger(next.pollIntervalMinutes) || next.pollIntervalMinutes < 5 || next.pollIntervalMinutes > 1440) throw invalid("pollIntervalMinutes", "Read every 5 minutes to once a day.");
  }
}

// Credentials: the fields given replace those kept; a generated one (a verify token, Google's key) is made when missing.
function mergeCredentials(provider, kept, given = {}) {
  const next = { ...kept };
  for (const field of provider.credentials) {
    const value = text(given[field.key]);
    if (value) next[field.key] = value.slice(0, 2000);
    if (!next[field.key] && field.generated) next[field.key] = randomBytes(18).toString("base64url");
  }
  const missing = provider.credentials.filter((field) => !next[field.key]);
  if (missing.length) throw invalid(`credentials.${missing[0].key}`, `Enter the ${missing[0].label}.`);
  return next;
}

// Returns { connector, webhookUrlKey?, credentials (generated ones only, shown once) }.
export async function createLeadConnector(client, context, input = {}, { env = process.env } = {}) {
  requireManage(context);
  const provider = providerOf(input.provider);
  const next = {};
  await cleanCommon(client, context, { name: input.name ?? provider.label, ...input }, next);
  if ((await client.query("SELECT 1 FROM tenant.crm_lead_connectors WHERE organization_id = $1 AND lower(name) = lower($2)", [context.organizationId, next.name])).rows[0])
    throw invalid("name", "Another connector already has this name.");
  const credentials = mergeCredentials(provider, {}, input.credentials);
  const sourceId = next.sourceId === undefined ? await providerSource(client, context, provider) : next.sourceId;
  const webhookKey = provider.push ? `lc_${randomBytes(24).toString("base64url")}` : null;
  const row = (await client.query(
    `INSERT INTO tenant.crm_lead_connectors (organization_id, provider, name, source_id, owner_user_id, encrypted_credentials, webhook_key_hash, webhook_key_prefix,
                                             poll_interval_minutes, polled_until, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, COALESCE($9, 15), $10, $11, $11) RETURNING id`,
    [context.organizationId, input.provider, next.name, sourceId, next.ownerUserId ?? null, JSON.stringify(await encryptSecret(credentials, env)),
      webhookKey ? hash(webhookKey) : null, webhookKey ? webhookKey.slice(0, 10) : null, next.pollIntervalMinutes ?? null,
      provider.pull ? new Date(Date.now() - FIRST_READ_DAYS * 86400000) : null, context.userId ?? null])).rows[0];
  const generated = Object.fromEntries(provider.credentials.filter((field) => field.generated).map((field) => [field.key, credentials[field.key]]));
  return { connector: await getLeadConnector(client, context, row.id, { env }), webhookKey, generated };
}

export async function updateLeadConnector(client, context, connectorId, input = {}, { env = process.env } = {}) {
  requireManage(context);
  const row = await loadRow(client, context, connectorId);
  const provider = providerOf(row.provider);
  const next = {};
  await cleanCommon(client, context, input, next);
  if (next.name && next.name.toLowerCase() !== row.name.toLowerCase()
    && (await client.query("SELECT 1 FROM tenant.crm_lead_connectors WHERE organization_id = $1 AND lower(name) = lower($2) AND id <> $3", [context.organizationId, next.name, row.id])).rows[0])
    throw invalid("name", "Another connector already has this name.");
  const credentials = input.credentials ? mergeCredentials(provider, await credentialsOf(row, env), input.credentials) : null;
  await client.query(
    `UPDATE tenant.crm_lead_connectors SET name = COALESCE($3, name), source_id = CASE WHEN $4 THEN $5 ELSE source_id END,
            owner_user_id = CASE WHEN $6 THEN $7 ELSE owner_user_id END, poll_interval_minutes = COALESCE($8, poll_interval_minutes),
            encrypted_credentials = COALESCE($9::jsonb, encrypted_credentials), last_error = CASE WHEN $9::jsonb IS NULL THEN last_error END,
            updated_by = $10, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, next.name ?? null, next.sourceId !== undefined, next.sourceId ?? null, next.ownerUserId !== undefined, next.ownerUserId ?? null,
      next.pollIntervalMinutes ?? null, credentials ? JSON.stringify(await encryptSecret(credentials, env)) : null, context.userId ?? null]);
  return getLeadConnector(client, context, row.id, { env });
}

export async function setLeadConnectorStatus(client, context, connectorId, status) {
  requireManage(context);
  if (!["active", "paused"].includes(status)) throw invalid("status", "Choose active or paused.");
  const row = await loadRow(client, context, connectorId);
  await client.query("UPDATE tenant.crm_lead_connectors SET status = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2",
    [context.organizationId, row.id, status, context.userId ?? null]);
  return getLeadConnector(client, context, row.id);
}

// A new webhook key (the old address stops working); shown once.
export async function rotateLeadConnectorWebhook(client, context, connectorId) {
  requireManage(context);
  const row = await loadRow(client, context, connectorId);
  if (!LEAD_PROVIDERS[row.provider]?.push) throw new CrmError(409, "This provider is read by CRM; it has no webhook address.", "CRM_CONNECTOR_NO_WEBHOOK");
  const webhookKey = `lc_${randomBytes(24).toString("base64url")}`;
  await client.query("UPDATE tenant.crm_lead_connectors SET webhook_key_hash = $3, webhook_key_prefix = $4, updated_by = $5, updated_at = now() WHERE organization_id = $1 AND id = $2",
    [context.organizationId, row.id, hash(webhookKey), webhookKey.slice(0, 10), context.userId ?? null]);
  return { connector: await getLeadConnector(client, context, row.id), webhookKey };
}

export async function listLeadConnectorEvents(client, context, connectorId, { limit = 50 } = {}) {
  requireManage(context);
  const row = await loadRow(client, context, connectorId);
  const { rows } = await client.query(
    `SELECT event.*, lead.code AS lead_code FROM tenant.crm_lead_connector_events event
       LEFT JOIN tenant.crm_leads lead ON lead.organization_id = event.organization_id AND lead.id = event.lead_id
      WHERE event.organization_id = $1 AND event.connector_id = $2 ORDER BY event.received_at DESC LIMIT $3`,
    [context.organizationId, row.id, Math.min(Math.max(Number(limit) || 50, 1), 200)]);
  return rows.map((event) => ({
    id: event.id, externalId: event.external_id, receivedAt: event.received_at, enquiryAt: event.enquiry_at, status: event.status,
    leadId: event.lead_id, leadCode: event.lead_code ?? null, recordType: event.record_type, recordId: event.record_id, summary: event.summary, error: event.error_message,
  }));
}

// ------------------------------------------------------------------ bringing leads in

// What the connector may do when a lead arrives: create a lead (with its assignment) and see records to log a repeat enquiry on. Recorded
// as the member who set the connector up.
function connectorAuthority(row) {
  return {
    organizationId: row.organization_id,
    userId: row.created_by,
    roleSlugs: [],
    permissions: [LEAD_PERMISSIONS.create, LEAD_PERMISSIONS.assign, LEAD_PERMISSIONS.viewAll, LEAD_PERMISSIONS.viewSensitive, "crm.records.view_all"],
  };
}

// One provider lead, once. Returns { status, leadId?, recordType?, recordId? }.
export async function ingestProviderLead(client, row, item) {
  const authority = connectorAuthority(row);
  const provider = LEAD_PROVIDERS[row.provider];
  const seen = (await client.query("SELECT status, lead_id, record_type, record_id FROM tenant.crm_lead_connector_events WHERE organization_id = $1 AND connector_id = $2 AND external_id = $3",
    [row.organization_id, row.id, item.externalId])).rows[0];
  if (seen) return { status: "duplicate", leadId: seen.lead_id, recordType: seen.record_type, recordId: seen.record_id };
  const record = (status, extra = {}) => client.query(
    `INSERT INTO tenant.crm_lead_connector_events (organization_id, connector_id, external_id, enquiry_at, status, lead_id, record_type, record_id, summary, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (connector_id, external_id) DO NOTHING`,
    [row.organization_id, row.id, item.externalId, item.enquiryAt ?? null, status, extra.leadId ?? null, extra.recordType ?? null, extra.recordId ?? null,
      extra.summary ?? null, extra.error ?? null]);
  const who = [item.input.firstName, item.input.lastName].filter(Boolean).join(" ") || item.input.companyName || item.input.email || item.input.mobile || "Someone";
  if (item.test) {
    await record("ignored", { summary: `Test lead from ${provider.label} (${who}) — the connection works` });
    return { status: "ignored" };
  }
  const input = { ...item.input };
  if (!input.firstName && !input.lastName && !input.companyName) input.firstName = who;
  if (row.source_id) input.sourceId = row.source_id;
  if (row.owner_user_id) input.ownerUserId = row.owner_user_id;
  await client.query("SAVEPOINT connector_lead");
  try {
    const lead = await withConsentSource(client, `connector:${row.provider}`, `${provider.label} lead ${item.externalId}`, () => createLead(client, authority, input, { origin: "integration" }));
    await client.query("RELEASE SAVEPOINT connector_lead");
    await record("created", { leadId: lead.id, recordType: "lead", recordId: lead.id, summary: `${who}${input.productInterest ? ` · ${input.productInterest}` : ""}` });
    return { status: "created", leadId: lead.id };
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT connector_lead");
    if (error instanceof CrmError && error.code === "CRM_LEAD_DUPLICATE") {
      const logged = await recordRepeatEnquiry(client, authority, null, input, error.details?.matches ?? [],
        { title: `${provider.label} enquiry`, notice: `enquired again on ${provider.label}` });
      await record("logged", { recordType: logged?.kind ?? null, recordId: logged?.id ?? null, summary: `${who} is already in CRM; the enquiry was logged on their ${logged?.kind ?? "record"}` });
      return { status: "logged", recordType: logged?.kind ?? null, recordId: logged?.id ?? null };
    }
    if (!(error instanceof CrmError)) throw error;
    await record("failed", { summary: who, error: error.message });
    return { status: "failed", error: error.message };
  }
}

async function noteReceipt(client, row, count) {
  await client.query(
    "UPDATE tenant.crm_lead_connectors SET last_received_at = now(), received_count = received_count + $3, last_error = NULL, last_error_at = NULL WHERE organization_id = $1 AND id = $2",
    [row.organization_id, row.id, count]);
}

export async function recordLeadConnectorError(client, organizationId, connectorId, error) {
  await client.query("UPDATE tenant.crm_lead_connectors SET last_error = $3, last_error_at = now(), last_polled_at = now() WHERE organization_id = $1 AND id = $2",
    [organizationId, connectorId, String(error?.message ?? error).slice(0, 1000)]);
}

// Pull providers (IndiaMART, TradeIndia): which connectors are due to be read now.
export async function listDueLeadConnectors(client, organizationId, now = new Date()) {
  const { rows } = await client.query(
    `SELECT id FROM tenant.crm_lead_connectors
      WHERE organization_id = $1 AND status = 'active' AND provider IN ('indiamart', 'tradeindia')
        AND (last_polled_at IS NULL OR last_polled_at <= $2::timestamptz - make_interval(mins => poll_interval_minutes))`, [organizationId, now]);
  return rows.map((row) => row.id);
}

// Reads one pull connector from where it last got to. The network read happens first (no transaction needed); `runTenant(work)` runs
// the writes. Returns { read, created, logged, failed, until }.
export async function pullLeadConnector({ runTenant }, organizationId, connectorId, { fetchImpl = fetch, env = process.env, now = new Date() } = {}) {
  const row = await runTenant((client) => client.query("SELECT * FROM tenant.crm_lead_connectors WHERE organization_id = $1 AND id = $2", [organizationId, connectorId]).then((result) => result.rows[0]));
  if (!row || row.status !== "active") return { skipped: true };
  const provider = providerOf(row.provider);
  if (!provider.pull) return { skipped: true };
  const credentials = await credentialsOf(row, env);
  const from = new Date(row.polled_until ?? now.getTime() - FIRST_READ_DAYS * 86400000);
  let result;
  try {
    result = await provider.pull(fetchImpl, credentials, { from, to: now });
  } catch (error) {
    await runTenant((client) => recordLeadConnectorError(client, organizationId, row.id, error));
    throw error;
  }
  return runTenant(async (client) => {
    const counts = { read: result.leads.length, created: 0, logged: 0, failed: 0, ignored: 0 };
    for (const item of result.leads) {
      const outcome = await ingestProviderLead(client, row, item);
      if (counts[outcome.status] !== undefined) counts[outcome.status] += 1;
    }
    await client.query("UPDATE tenant.crm_lead_connectors SET last_polled_at = now(), polled_until = $3 WHERE organization_id = $1 AND id = $2",
      [organizationId, row.id, result.until]);
    if (result.leads.length) await noteReceipt(client, row, result.leads.length);
    else await client.query("UPDATE tenant.crm_lead_connectors SET last_error = NULL, last_error_at = NULL WHERE organization_id = $1 AND id = $2", [organizationId, row.id]);
    return { ...counts, until: result.until };
  });
}

// "Read now", from the connector's screen.
export async function pullLeadConnectorNow(client, context, connectorId, options = {}) {
  requireManage(context);
  const row = await loadRow(client, context, connectorId);
  if (!LEAD_PROVIDERS[row.provider]?.pull) throw new CrmError(409, "This provider sends its leads to the webhook; there is nothing to read.", "CRM_CONNECTOR_NO_PULL");
  // The request's own transaction: a provider's refusal is returned (and kept on the connector), not thrown, so it is not rolled back.
  try {
    return await pullLeadConnector({ runTenant: (work) => work(client) }, context.organizationId, row.id, options);
  } catch (error) {
    if (!(error instanceof CrmError)) throw error;
    return { read: 0, created: 0, logged: 0, failed: 0, error: error.message, code: error.code };
  }
}

// ------------------------------------------------------------------ webhooks

// A webhook's key: its connector, before any organization context exists. Sets the context.
export async function resolveLeadConnectorWebhook(client, webhookKey) {
  const key = String(webhookKey ?? "");
  if (!/^lc_[A-Za-z0-9_-]{20,64}$/.test(key)) throw new CrmError(404, "Unknown connector address.", "CRM_CONNECTOR_NOT_FOUND");
  const organizationId = (await client.query("SELECT tenant.crm_resolve_lead_connector($1) AS organization_id", [hash(key)])).rows[0]?.organization_id;
  if (!organizationId) throw new CrmError(404, "Unknown connector address.", "CRM_CONNECTOR_NOT_FOUND");
  await setTenantContext(client, organizationId);
  const row = (await client.query("SELECT * FROM tenant.crm_lead_connectors WHERE organization_id = $1 AND webhook_key_hash = $2", [organizationId, hash(key)])).rows[0];
  if (!row) throw new CrmError(404, "Unknown connector address.", "CRM_CONNECTOR_NOT_FOUND");
  return row;
}

// Meta's subscription check (GET). Returns the challenge to echo, or null.
export async function verifyLeadConnectorSubscription(row, params, { env = process.env } = {}) {
  const provider = LEAD_PROVIDERS[row.provider];
  if (!provider?.verifySubscription) return null;
  return provider.verifySubscription(await credentialsOf(row, env), params);
}

// A provider POSTs leads. `runTenant(work)` runs the writes; a provider that must be asked for the lead (Meta) is asked first, outside it.
// Returns { received, created, logged, failed, ignored, duplicate }.
export async function receiveLeadConnectorWebhook({ runTenant }, row, { rawBody, headers, body }, { fetchImpl = fetch, env = process.env } = {}) {
  const provider = providerOf(row.provider);
  if (!provider.push) throw new CrmError(404, "This connector has no webhook.", "CRM_CONNECTOR_NO_WEBHOOK");
  if (row.status !== "active") throw new CrmError(409, "This connector is paused.", "CRM_CONNECTOR_PAUSED");
  const credentials = await credentialsOf(row, env);
  provider.verifyPush?.(credentials, rawBody, headers);
  let items;
  try {
    items = await provider.fromPush(body, { fetchImpl, credentials });
  } catch (error) {
    await runTenant((client) => recordLeadConnectorError(client, row.organization_id, row.id, error));
    throw error;
  }
  return runTenant(async (client) => {
    const counts = { received: items.length, created: 0, logged: 0, failed: 0, ignored: 0, duplicate: 0 };
    for (const item of items) {
      const outcome = await ingestProviderLead(client, row, item);
      if (counts[outcome.status] !== undefined) counts[outcome.status] += 1;
    }
    if (items.length) await noteReceipt(client, row, items.length);
    return counts;
  });
}
