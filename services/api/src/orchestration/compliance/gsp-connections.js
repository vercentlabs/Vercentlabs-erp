// E-invoice per company (Sales report Phase 2): each GSTIN connects its own GST Suvidha Provider account. The credentials are encrypted
// with the platform's secrets envelope and never returned; the screen shows only a hint (the user name) and the connection's state.
// Every call made with a connection is logged (action, success, who). A GSTIN without a connection uses the platform-wide GSP, if any.
//
// Adapters: how one provider is spoken to. Each has
//   label, fields (what Setup asks for), call(path, body, credentials, { fetchImpl }) -> the answer, test(credentials, { fetchImpl })
// `vercentlabs` speaks the JSON contract documented in ./index.js; `standin` answers locally (never in production).
import { isProductionRuntime } from "@vercentlabs/config";
import { hasSessionPermission } from "../../core/access/index.js";
import { decryptSecret, encryptSecret } from "../../core/platform/secrets/index.js";

export class GspConnectionError extends Error {
  constructor(status, message, code = "GSP_CONNECTION_ERROR", details) {
    super(message);
    this.name = "GspConnectionError";
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value, max) => String(value ?? "").trim().slice(0, max);

async function post(url, path, body, headers, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${url.replace(/\/+$/, "")}/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", ...headers }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000), redirect: "error",
    });
  } catch {
    throw new GspConnectionError(502, "The GSP could not be reached. Try again.", "GSP_UNREACHABLE");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new GspConnectionError(response.status >= 500 ? 502 : 422, `The GSP refused it: ${String(payload?.error ?? payload?.message ?? response.status).slice(0, 400)}`, "GSP_REFUSED");
  return payload;
}

export const GSP_ADAPTERS = Object.freeze({
  vercentlabs: Object.freeze({
    label: "GSP with the Vercentlabs connector (URL and API token)",
    fields: ["baseUrl", "username", "token"],
    validate(input) {
      const url = text(input.baseUrl, 300);
      if (!/^https:\/\/[^\s/]+/.test(url)) throw new GspConnectionError(400, "Enter the GSP's address, starting https://.", "GSP_CONNECTION_INVALID", { field: "baseUrl" });
      if (!text(input.token, 4000)) throw new GspConnectionError(400, "Enter the API token from your GSP.", "GSP_CONNECTION_INVALID", { field: "token" });
      return { baseUrl: url.replace(/\/+$/, ""), credentials: { token: text(input.token, 4000), username: text(input.username, 120) || null } };
    },
    call: (path, body, connection, { fetchImpl = fetch } = {}) =>
      post(connection.baseUrl, path, body, { Authorization: `Bearer ${connection.credentials.token}`, "x-gstin": body.gstin }, fetchImpl),
    test: (connection, gstin, { fetchImpl = fetch } = {}) =>
      post(connection.baseUrl, "auth/test", { gstin }, { Authorization: `Bearer ${connection.credentials.token}`, "x-gstin": gstin }, fetchImpl),
  }),
  standin: Object.freeze({
    label: "Test connection (answers locally, no government call)",
    fields: [],
    validate: () => ({ baseUrl: null, credentials: { token: "standin" } }),
    call: () => null,
    test: async () => ({ ok: true }),
  }),
});

const adapterFor = (provider, env) => {
  if (provider === "standin" && isProductionRuntime(env)) return null;
  return GSP_ADAPTERS[provider] ?? null;
};

function requireManage(session) {
  if (!hasSessionPermission(session, "tax.registrations.manage") && !hasSessionPermission(session, "sales.settings.manage"))
    throw new GspConnectionError(403, "You do not have permission to connect a GSP.", "PERMISSION_DENIED");
}

const view = (row) => (row ? {
  provider: row.provider, providerLabel: GSP_ADAPTERS[row.provider]?.label ?? row.provider, baseUrl: row.base_url, credentialHint: row.credential_hint, status: row.status,
  lastTestedAt: row.last_tested_at, lastError: row.last_error, lastUsedAt: row.last_used_at, useCount: row.use_count,
} : null);

// Each active GSTIN of the company and its connection (without any secret), and the providers that can be chosen.
export async function listGspConnections(client, session, env = process.env) {
  requireManage(session);
  const rows = (await client.query(
    `SELECT connection.*, registration.id AS gstin_registration_id, registration.name AS gstin_name, registration.registration_number AS gstin
       FROM tenant.tax_registrations registration
       LEFT JOIN tenant.gsp_connections connection ON connection.organization_id = registration.organization_id AND connection.registration_id = registration.id
      WHERE registration.organization_id = $1 AND registration.status = 'active' AND registration.registration_number IS NOT NULL
      ORDER BY registration.is_default DESC, registration.name`, [session.organizationId])).rows;
  return {
    registrations: rows.map((row) => ({ registrationId: row.gstin_registration_id, name: row.gstin_name, gstin: row.gstin, connection: row.provider ? view(row) : null })),
    providers: Object.entries(GSP_ADAPTERS).filter(([key]) => adapterFor(key, env)).map(([key, adapter]) => ({ value: key, label: adapter.label, fields: adapter.fields })),
  };
}

async function registrationOf(client, session, registrationId) {
  if (!UUID.test(String(registrationId ?? ""))) throw new GspConnectionError(404, "GSTIN not found.", "GSP_REGISTRATION_NOT_FOUND");
  const row = (await client.query("SELECT id, registration_number FROM tenant.tax_registrations WHERE organization_id = $1 AND id = $2 AND status = 'active'",
    [session.organizationId, registrationId])).rows[0];
  if (!row?.registration_number) throw new GspConnectionError(404, "GSTIN not found.", "GSP_REGISTRATION_NOT_FOUND");
  return row;
}

// input: { provider, baseUrl?, username?, token? }. Replaces the GSTIN's connection; it is untested until Test is pressed.
export async function saveGspConnection(client, session, registrationId, input = {}, env = process.env) {
  requireManage(session);
  const registration = await registrationOf(client, session, registrationId);
  const provider = text(input.provider, 40);
  const adapter = adapterFor(provider, env);
  if (!adapter) throw new GspConnectionError(400, "Choose your GSP.", "GSP_CONNECTION_INVALID", { field: "provider" });
  const { baseUrl, credentials } = adapter.validate(input);
  const sealed = await encryptSecret(credentials, env);
  await client.query(
    `INSERT INTO tenant.gsp_connections (organization_id, registration_id, provider, base_url, encrypted_credentials, credential_hint, status, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'untested', $7, $7)
     ON CONFLICT (organization_id, registration_id) DO UPDATE SET provider = EXCLUDED.provider, base_url = EXCLUDED.base_url, encrypted_credentials = EXCLUDED.encrypted_credentials,
       credential_hint = EXCLUDED.credential_hint, status = 'untested', last_error = NULL, last_tested_at = NULL, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [session.organizationId, registration.id, provider, baseUrl, JSON.stringify(sealed), credentials.username ?? null, session.userId ?? null]);
  const row = (await client.query("SELECT * FROM tenant.gsp_connections WHERE organization_id = $1 AND registration_id = $2", [session.organizationId, registration.id])).rows[0];
  await logUse(client, session.organizationId, row.id, "saved", true, null, session.userId);
  return { connection: view(row) };
}

export async function deleteGspConnection(client, session, registrationId) {
  requireManage(session);
  const registration = await registrationOf(client, session, registrationId);
  const removed = await client.query("DELETE FROM tenant.gsp_connections WHERE organization_id = $1 AND registration_id = $2 RETURNING id", [session.organizationId, registration.id]);
  if (removed.rows[0]) await logUse(client, session.organizationId, removed.rows[0].id, "removed", true, null, session.userId);
  return { removed: Boolean(removed.rows[0]) };
}

async function openConnection(row, env) {
  return { provider: row.provider, baseUrl: row.base_url, credentials: await decryptSecret(row.encrypted_credentials, env) };
}

// Asks the GSP whether the credentials work, and keeps the answer on the connection.
export async function testGspConnection(client, session, registrationId, options = {}) {
  requireManage(session);
  const env = options.env ?? process.env;
  const registration = await registrationOf(client, session, registrationId);
  const row = (await client.query("SELECT * FROM tenant.gsp_connections WHERE organization_id = $1 AND registration_id = $2 FOR UPDATE",
    [session.organizationId, registration.id])).rows[0];
  if (!row) throw new GspConnectionError(404, "Connect a GSP for this GSTIN first.", "GSP_CONNECTION_NOT_FOUND");
  const adapter = adapterFor(row.provider, env);
  let error = null;
  try {
    if (!adapter) throw new GspConnectionError(409, "This GSP cannot be used here.", "GSP_CONNECTION_INVALID");
    await adapter.test(await openConnection(row, env), registration.registration_number, options);
  } catch (problem) {
    if (!(problem instanceof GspConnectionError)) throw problem;
    error = problem.message;
  }
  await client.query("UPDATE tenant.gsp_connections SET status = $3, last_tested_at = now(), last_error = $4 WHERE organization_id = $1 AND id = $2",
    [session.organizationId, row.id, error ? "failed" : "connected", error]);
  await logUse(client, session.organizationId, row.id, "tested", !error, error, session.userId);
  return { connected: !error, error };
}

async function logUse(client, organizationId, connectionId, action, ok, detail, userId) {
  await client.query("INSERT INTO tenant.gsp_connection_events (organization_id, connection_id, action, ok, detail, user_id) VALUES ($1, $2, $3, $4, $5, $6)",
    [organizationId, connectionId, action, ok, detail ? String(detail).slice(0, 500) : null, userId ?? null]);
}

// The connection for a seller GSTIN, opened, or null. A connection that failed its last test is still tried (it may have been fixed at
// the GSP); one whose provider cannot run here is not.
export async function companyGsp(client, organizationId, gstin, env = process.env) {
  const row = (await client.query(
    `SELECT connection.* FROM tenant.gsp_connections connection JOIN tenant.tax_registrations registration
        ON registration.organization_id = connection.organization_id AND registration.id = connection.registration_id
      WHERE connection.organization_id = $1 AND registration.registration_number = $2`, [organizationId, gstin])).rows[0];
  if (!row || !adapterFor(row.provider, env)) return null;
  return { row, adapter: adapterFor(row.provider, env), connection: await openConnection(row, env) };
}

// Whether the company has a usable connection for any GSTIN.
export async function companyHasGsp(client, organizationId, env = process.env) {
  const rows = (await client.query("SELECT provider FROM tenant.gsp_connections WHERE organization_id = $1", [organizationId])).rows;
  return rows.some((row) => adapterFor(row.provider, env));
}

// One call through a company connection, logged with its outcome.
export async function callCompanyGsp(client, organizationId, found, path, body, { userId = null, fetchImpl, standin } = {}) {
  try {
    const answer = found.row.provider === "standin" ? standin(path, body) : await found.adapter.call(path, body, found.connection, { fetchImpl });
    await logUse(client, organizationId, found.row.id, path, true, null, userId);
    await client.query("UPDATE tenant.gsp_connections SET last_used_at = now(), use_count = use_count + 1 WHERE organization_id = $1 AND id = $2", [organizationId, found.row.id]);
    return answer;
  } catch (error) {
    await logUse(client, organizationId, found.row.id, path, false, error?.message, userId);
    throw error;
  }
}
