// GSTIN status check and company lookup (CRM plan 5.6). What the GST register says about a GSTIN — active, cancelled or suspended,
// its legal and trade name, registration date and principal place of business — from the organization's GST data provider, so a
// prospect's GSTIN is verified before the first quote, and a new company or lead can be filled in from its GSTIN.
//
// The provider is any GST verification API (a GSP or a verification service) that answers a GSTIN with the GST register's own fields
// (lgnm, tradeNam, sts, rgdt, cxdt, ctb, pradr.addr…) or their plain names (legalName, tradeName, status…):
//   GST_LOOKUP_URL      the address, with {gstin} where the GSTIN goes   (e.g. https://gst.example.com/v1/taxpayers/{gstin})
//   GST_LOOKUP_API_KEY  sent as the header GST_LOOKUP_KEY_HEADER (default "x-api-key")
// A company can set its own provider instead (its GSP account, CRM audit): Setup › GST register lookup, kept encrypted; its address
// must be public (the webhook rules), and it is asked without following redirects.
// Without one, CRM still checks the GSTIN's format and check character and says the register could not be asked. Answers are kept
// (crm_gstin_checks); a GSTIN checked in the last 7 days is answered from there unless a fresh check is asked for.
import { findIndianState, parseGstin } from "@vercentlabs/shared-types";

import { decryptSecret, encryptSecret } from "../../../core/platform/secrets/index.js";
import { resolveSafeAddress, validateWebhookUrl } from "../../../core/platform/integrations/webhooks/ssrf.js";

import { CrmError } from "../data-management/errors.js";
import { recordAccountHistory } from "../accounts/history.js";
import { lockAccount } from "../accounts/records.js";

const FRESH_DAYS = 7;
const STATUS = Object.freeze({ active: "active", act: "active", cancelled: "cancelled", cancel: "cancelled", "cancelled suo-moto": "cancelled",
  suspended: "suspended", inactive: "inactive", provisional: "active" });
export const GSTIN_STATUS_LABELS = Object.freeze({ active: "Active", cancelled: "Cancelled", suspended: "Suspended", inactive: "Inactive", not_found: "Not registered", unknown: "Not checked" });

// dd/mm/yyyy or yyyy-mm-dd → yyyy-mm-dd
function dayOf(value) {
  const text = String(value ?? "").trim();
  const dmy = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(text);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

// The register's answer in one shape, whatever the provider calls its fields.
export function readRegisterAnswer(body, gstin) {
  const data = body?.data ?? body?.result ?? body?.taxpayerInfo ?? body;
  if (!data || typeof data !== "object") return null;
  const addr = data.pradr?.addr ?? data.principalAddress ?? data.address ?? {};
  const statusText = String(data.sts ?? data.status ?? data.gstinStatus ?? "").trim().toLowerCase();
  const state = findIndianState({ code: gstin.slice(0, 2) });
  const address = {
    line1: [addr.bno ?? addr.buildingNumber, addr.bnm ?? addr.buildingName, addr.flno ?? addr.floor].filter(Boolean).join(", ") || addr.line1 || null,
    line2: [addr.st ?? addr.street, addr.loc ?? addr.locality].filter(Boolean).join(", ") || addr.line2 || null,
    city: addr.city ?? addr.dst ?? addr.district ?? null,
    state: state?.name ?? addr.stcd ?? addr.state ?? null,
    stateCode: gstin.slice(0, 2),
    postalCode: addr.pncd ?? addr.pincode ?? addr.postalCode ?? null,
  };
  return {
    status: STATUS[statusText] ?? (statusText ? "unknown" : "unknown"),
    legalName: data.lgnm ?? data.legalName ?? data.legal_name ?? null,
    tradeName: data.tradeNam ?? data.tradeName ?? data.trade_name ?? null,
    registeredOn: dayOf(data.rgdt ?? data.registrationDate),
    cancelledOn: dayOf(data.cxdt ?? data.cancellationDate),
    taxpayerType: data.dty ?? data.ctb ?? data.taxpayerType ?? null,
    address,
  };
}

function toCheck(row) {
  return {
    gstin: row.gstin, status: row.status, statusLabel: GSTIN_STATUS_LABELS[row.status] ?? row.status, legalName: row.legal_name ?? null, tradeName: row.trade_name ?? null,
    // calendar days, read as text: a date has no time zone to shift it
    registeredOn: row.registered_text ?? null,
    cancelledOn: row.cancelled_text ?? null,
    taxpayerType: row.taxpayer_type ?? null, address: row.address ?? {}, provider: row.provider, checkedAt: row.checked_at,
  };
}

export const gstLookupConfigured = (env = process.env) => Boolean(env.GST_LOOKUP_URL);

const MANAGE = "crm.settings.manage";
const HEADER = /^[A-Za-z][A-Za-z0-9-]{0,60}$/;

async function ownProvider(client, organizationId, env) {
  const row = (await client.query("SELECT gst_lookup FROM tenant.crm_settings WHERE organization_id = $1", [organizationId])).rows[0];
  return row?.gst_lookup ? await decryptSecret(row.gst_lookup, env) : null;
}

// Who answers this organization's GSTIN checks: its own provider, else the platform's, else nobody. { url, headers, own } or null.
async function lookupProvider(client, organizationId, env) {
  const own = await ownProvider(client, organizationId, env);
  if (own?.url) return { url: own.url, headers: own.apiKey ? { [own.keyHeader || "x-api-key"]: own.apiKey } : {}, own: true };
  if (env.GST_LOOKUP_URL) return { url: env.GST_LOOKUP_URL, headers: env.GST_LOOKUP_API_KEY ? { [env.GST_LOOKUP_KEY_HEADER || "x-api-key"]: env.GST_LOOKUP_API_KEY } : {}, own: false };
  return null;
}

// Whether GSTIN checks reach a register for this organization.
export async function gstLookupConfiguredFor(client, organizationId, env = process.env) {
  return Boolean(await lookupProvider(client, organizationId, env));
}

// The company's own provider, as Setup shows it (never the key).
export async function getGstLookupSettings(client, context, { env = process.env } = {}) {
  const own = await ownProvider(client, context.organizationId, env);
  return { own: Boolean(own?.url), url: own?.url ?? null, keyHeader: own?.keyHeader ?? "x-api-key", keySet: Boolean(own?.apiKey), platform: gstLookupConfigured(env) };
}

// input: { url, apiKey?, keyHeader? } (the key is kept when left out), or { clear: true } to go back to the platform's.
export async function saveGstLookupSettings(client, context, input = {}, { env = process.env } = {}) {
  if (!(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(MANAGE))) throw new CrmError(403, "You do not have permission to set up the GST lookup.", "PERMISSION_DENIED");
  let stored = null;
  if (input.clear !== true) {
    const kept = (await ownProvider(client, context.organizationId, env)) ?? {};
    const url = String(input.url ?? kept.url ?? "").trim();
    const issue = (field, message) => new CrmError(400, message, "CRM_GST_LOOKUP_VALIDATION", { issues: [{ field, message }] });
    if (!url.includes("{gstin}")) throw issue("url", "Put {gstin} where the GSTIN goes in the address.");
    let parsed;
    try { parsed = validateWebhookUrl(url.replace("{gstin}", "27AAAAA0000A1Z5")); } catch { parsed = null; }
    if (!parsed || parsed.protocol !== "https:") throw issue("url", "Use your provider's public https address.");
    const keyHeader = String(input.keyHeader ?? kept.keyHeader ?? "x-api-key").trim() || "x-api-key";
    if (!HEADER.test(keyHeader)) throw issue("keyHeader", "Use the header name your provider asks for, such as x-api-key.");
    const apiKey = String(input.apiKey ?? "").trim() || kept.apiKey || null;
    stored = JSON.stringify(await encryptSecret({ url: url.slice(0, 500), keyHeader, apiKey: apiKey ? apiKey.slice(0, 500) : null }, env));
  }
  await client.query(
    `INSERT INTO tenant.crm_settings (organization_id, gst_lookup, created_by, updated_by) VALUES ($1, $2::jsonb, $3, $3)
     ON CONFLICT (organization_id) DO UPDATE SET gst_lookup = EXCLUDED.gst_lookup, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, stored, context.userId ?? null]);
  return getGstLookupSettings(client, context, { env });
}

// The latest answer about a GSTIN this organization has, or null.
export async function latestGstinCheck(client, organizationId, gstin) {
  const row = (await client.query("SELECT *, to_char(registered_on, 'YYYY-MM-DD') AS registered_text, to_char(cancelled_on, 'YYYY-MM-DD') AS cancelled_text FROM tenant.crm_gstin_checks WHERE organization_id = $1 AND gstin = $2 ORDER BY checked_at DESC LIMIT 1", [organizationId, gstin])).rows[0];
  return row ? toCheck(row) : null;
}

// Checks a GSTIN with the register. options: { refresh, fetchImpl, env }
// Returns { gstin, valid, formatError?, configured, check? } — check is the register's answer (kept), or null when it could not be asked.
export async function verifyGstin(client, context, value, { refresh = false, fetchImpl = fetch, env = process.env } = {}) {
  const parsed = parseGstin(value);
  if (!parsed.valid) return { gstin: parsed.gstin, valid: false, formatError: parsed.error ?? "Enter a GSTIN.", configured: await gstLookupConfiguredFor(client, context.organizationId, env), check: null };
  const gstin = parsed.gstin;
  const provider = await lookupProvider(client, context.organizationId, env);
  if (!refresh) {
    const recent = (await client.query(
      "SELECT *, to_char(registered_on, 'YYYY-MM-DD') AS registered_text, to_char(cancelled_on, 'YYYY-MM-DD') AS cancelled_text FROM tenant.crm_gstin_checks WHERE organization_id = $1 AND gstin = $2 AND checked_at > now() - make_interval(days => $3) ORDER BY checked_at DESC LIMIT 1",
      [context.organizationId, gstin, FRESH_DAYS])).rows[0];
    if (recent) return { gstin, valid: true, configured: true, check: toCheck(recent), cached: true };
  }
  if (!provider) return { gstin, valid: true, configured: false, check: null };
  let response;
  try {
    const url = provider.url.replace("{gstin}", encodeURIComponent(gstin));
    // A company's own address is asked only when it resolves to a public address, and never follows a redirect.
    if (provider.own) await resolveSafeAddress(new URL(url).hostname);
    response = await fetchImpl(url, { headers: { accept: "application/json", ...provider.headers }, ...(provider.own ? { redirect: "error" } : {}) });
  } catch {
    throw new CrmError(502, "The GST register could not be reached. Try again in a moment.", "CRM_GSTIN_LOOKUP_UNAVAILABLE");
  }
  let answer;
  if (response.status === 404) answer = { status: "not_found", address: {} };
  else if (!response.ok) throw new CrmError(502, "The GST register did not answer. Try again in a moment.", "CRM_GSTIN_LOOKUP_UNAVAILABLE");
  else {
    const body = await response.json().catch(() => null);
    answer = readRegisterAnswer(body, gstin);
    if (!answer) throw new CrmError(502, "The GST register's answer could not be read.", "CRM_GSTIN_LOOKUP_UNAVAILABLE");
    if (body?.error || body?.flag === false) answer.status = "not_found";
  }
  const row = (await client.query(
    `INSERT INTO tenant.crm_gstin_checks (organization_id, gstin, status, legal_name, trade_name, registered_on, cancelled_on, taxpayer_type, address, provider, checked_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11) RETURNING *, to_char(registered_on, 'YYYY-MM-DD') AS registered_text, to_char(cancelled_on, 'YYYY-MM-DD') AS cancelled_text`,
    [context.organizationId, gstin, answer.status, answer.legalName ?? null, answer.tradeName ?? null, answer.registeredOn ?? null, answer.cancelledOn ?? null,
      answer.taxpayerType ?? null, JSON.stringify(answer.address ?? {}), new URL(provider.url.replace("{gstin}", gstin)).hostname, context.userId ?? null])).rows[0];
  return { gstin, valid: true, configured: true, check: toCheck(row) };
}

// Company lookup from a GSTIN: what a new company or lead form can be filled in with.
export async function lookupCompanyByGstin(client, context, value, options = {}) {
  const result = await verifyGstin(client, context, value, options);
  if (!result.valid) throw new CrmError(400, result.formatError, "CRM_GSTIN_INVALID");
  const check = result.check;
  const parsed = parseGstin(value);
  return {
    gstin: result.gstin, configured: result.configured, status: check?.status ?? "unknown", statusLabel: check ? check.statusLabel : GSTIN_STATUS_LABELS.unknown,
    displayName: check?.tradeName || check?.legalName || null, legalName: check?.legalName ?? null, pan: parsed.pan,
    address: check?.address ?? { stateCode: parsed.stateCode, state: findIndianState({ code: parsed.stateCode })?.name ?? null },
  };
}

// Verifies a company's own GSTIN and records the result on its history. Returns the check; warns when the register's legal name
// differs from the company's.
export async function verifyAccountGstin(client, context, partyId, options = {}) {
  const row = await lockAccount(client, context, partyId);
  if (!row.gstin) throw new CrmError(409, "Add the company's GSTIN first.", "CRM_GSTIN_MISSING");
  const result = await verifyGstin(client, context, row.gstin, { ...options, refresh: options.refresh ?? true });
  if (!result.valid) throw new CrmError(400, result.formatError, "CRM_GSTIN_INVALID");
  if (!result.check) return { ...result, warnings: [] };
  const warnings = [];
  const names = [result.check.legalName, result.check.tradeName].filter(Boolean).map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const own = [row.display_name, row.legal_name].filter(Boolean).map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (names.length && !names.some((name) => own.some((mine) => mine && (name.includes(mine) || mine.includes(name)))))
    warnings.push({ code: "name_mismatch", message: `The GST register names this GSTIN "${result.check.legalName ?? result.check.tradeName}".` });
  if (result.check.status !== "active") warnings.push({ code: "not_active", message: `The GSTIN is ${result.check.statusLabel.toLowerCase()} on the GST register.` });
  await recordAccountHistory(client, context, row.id, "tax_identity_changed", `GSTIN ${result.gstin} verified: ${result.check.statusLabel}`, { gstinCheck: { status: result.check.status, legalName: result.check.legalName } });
  return { ...result, warnings };
}
