// The one numbering system: tenant.document_sequences holds counter state,
// tenant.document_numbering_policies holds (optional) administrator
// configuration, and nextDocumentNumber() is the only allocator.
// public.numbering_series is retired (migrated by tenant migration 181).
//
// Format:  <prefix><number>                    reset "never" (the default)
//          <prefix><period>-<number>           reset per calendar/fiscal year,
//                                              e.g. INV-2026-27-00001
// A reset policy always puts the period in the identifier, so a new period
// can never re-issue an identifier issued in an earlier one. Counters only
// move forward: there is no way to lower a next number.
import { fiscalYearFor } from "@vercentlabs/localization";

import { audit } from "../../security.js";
import { DOCUMENT_TYPES, getDocumentType, RESET_POLICIES } from "./registry.js";

export class DocumentNumberError extends Error {
  constructor(status, message, code = "DOCUMENT_NUMBER_ERROR") {
    super(message);
    this.name = "DocumentNumberError";
    this.status = status;
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX = /^[A-Z0-9][A-Z0-9/_-]{0,23}$/;

function modulePrefix(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9/_-]{1,40}$/.test(text)) throw new DocumentNumberError(400, "Document prefix contains unsupported characters.", "DOCUMENT_NUMBER_PREFIX_INVALID");
  return text;
}

function resolveType(documentType) {
  const definition = getDocumentType(documentType);
  if (!definition) throw new DocumentNumberError(500, `Document type "${documentType}" is not registered for numbering.`, "DOCUMENT_NUMBER_TYPE_UNREGISTERED");
  return definition;
}

// Counter scope. Organisation-scoped types keep one counter per organisation
// in document_sequences, keyed by the organisation id in the company column
// (the table has no company foreign key; this sentinel is deliberate).
function counterCompanyId(definition, context) {
  if (definition.scope === "organization") return context.organizationId;
  const companyId = context?.companyId || context?.activeCompanyId;
  if (!companyId) throw new DocumentNumberError(400, "Organization and active company are required for numbering.", "DOCUMENT_NUMBER_SCOPE_REQUIRED");
  return companyId;
}

async function loadPolicy(client, organizationId, companyId, definition) {
  if (definition.family) return null;
  const { rows } = await client.query(
    `SELECT * FROM tenant.document_numbering_policies
      WHERE organization_id=$1 AND document_type=$2 AND status='active'
        AND (($3::uuid IS NULL AND company_id IS NULL) OR company_id=$3::uuid)`,
    [organizationId, definition.key, definition.scope === "organization" ? null : companyId],
  );
  return rows[0] || null;
}

async function periodFor(client, organizationId, resetPolicy, at) {
  if (resetPolicy === "calendar_year") {
    const year = String(at.getUTCFullYear());
    return { key: `cy${year}`, label: year };
  }
  if (resetPolicy === "fiscal_year") {
    const { rows } = await client.query(`SELECT fiscal_year_start_month FROM public.organizations WHERE id=$1`, [organizationId]);
    const fiscal = fiscalYearFor(at, Number(rows[0]?.fiscal_year_start_month || 4));
    return { key: `fy${fiscal.startYear}`, label: fiscal.label };
  }
  return { key: "global", label: null };
}

export function formatDocumentNumber({ prefix, padding, value, periodLabel = null }) {
  const sequence = String(value).padStart(Number(padding), "0");
  return periodLabel ? `${prefix}${periodLabel}-${sequence}` : `${prefix}${sequence}`;
}

/**
 * Allocate the next identifier for a registered document type. Must run
 * inside the caller's authoritative tenant transaction. `prefix`/`padding`
 * are the module's own defaults (a POS store's receipt prefix, ...); an
 * administrator policy for the type overrides them. A caller-supplied
 * `periodKey` partitions the counter itself (one series per terminal/report)
 * and is not combined with a reset policy.
 *
 * One statement reads the policy, derives the period and moves the counter,
 * so a concurrent policy change can never pair one format with another's
 * counter.
 */
export async function nextDocumentNumber(client, context, { documentType, prefix, padding, periodKey, at = new Date() } = {}) {
  if (!context?.organizationId) throw new DocumentNumberError(400, "Organization and active company are required for numbering.", "DOCUMENT_NUMBER_SCOPE_REQUIRED");
  const type = String(documentType || "").trim().toLowerCase();
  if (!/^[a-z0-9._:-]{1,160}$/.test(type)) throw new DocumentNumberError(400, "Document type contains unsupported characters.", "DOCUMENT_NUMBER_TYPE_INVALID");
  const definition = resolveType(type);
  const companyId = counterCompanyId(definition, context);
  const defaultPrefix = prefix ? `${modulePrefix(prefix)}${definition.scope === "organization" ? "" : "-"}` : definition.defaultPrefix;
  const defaultPadding = Math.min(Math.max(Number(padding ?? definition.defaultPadding) || 6, 1), 18);
  const explicitPeriod = periodKey ? String(periodKey).trim().toLowerCase().slice(0, 80) || "global" : null;
  const policyScope = definition.family ? "none" : definition.scope === "organization" ? "organization" : "company";

  const { rows } = await client.query(
    `WITH policy AS (
       SELECT prefix, padding, reset_policy FROM tenant.document_numbering_policies
        WHERE $7::text <> 'none' AND organization_id=$1 AND document_type=$3 AND status='active'
          AND (($7::text = 'organization' AND company_id IS NULL) OR ($7::text = 'company' AND company_id=$2::uuid))
        LIMIT 1
     ), settings AS (
       SELECT COALESCE((SELECT fiscal_year_start_month FROM public.organizations WHERE id=$1), 4) AS start_month,
              extract(year FROM $8::timestamptz AT TIME ZONE 'UTC')::int AS y,
              extract(month FROM $8::timestamptz AT TIME ZONE 'UTC')::int AS m
     ), effective AS (
       SELECT COALESCE(policy.prefix, $5) AS prefix,
              COALESCE(policy.padding, $6) AS padding,
              CASE WHEN $4::text IS NOT NULL THEN $4::text
                   WHEN policy.reset_policy = 'calendar_year' THEN 'cy' || settings.y
                   WHEN policy.reset_policy = 'fiscal_year' THEN 'fy' || (settings.y - CASE WHEN settings.m < settings.start_month THEN 1 ELSE 0 END)
                   ELSE 'global' END AS period_key,
              CASE WHEN $4::text IS NOT NULL THEN NULL
                   WHEN policy.reset_policy = 'calendar_year' THEN settings.y::text
                   WHEN policy.reset_policy = 'fiscal_year' THEN (settings.y - CASE WHEN settings.m < settings.start_month THEN 1 ELSE 0 END)::text
                        || '-' || lpad(((settings.y - CASE WHEN settings.m < settings.start_month THEN 1 ELSE 0 END + 1) % 100)::text, 2, '0')
                   ELSE NULL END AS period_label
         FROM settings LEFT JOIN policy ON true
     )
     INSERT INTO tenant.document_sequences (organization_id,company_id,document_type,period_key,prefix,padding,next_value)
     SELECT $1,$2,$3,effective.period_key,effective.prefix,effective.padding,2 FROM effective
     ON CONFLICT (organization_id,company_id,document_type,period_key)
     DO UPDATE SET next_value=tenant.document_sequences.next_value+1, prefix=EXCLUDED.prefix, padding=EXCLUDED.padding, updated_at=now()
     RETURNING (next_value-1)::text AS allocated_value,
               (SELECT prefix FROM effective) AS effective_prefix,
               (SELECT padding FROM effective) AS effective_padding,
               (SELECT period_label FROM effective) AS period_label`,
    [context.organizationId, companyId, type, explicitPeriod, defaultPrefix, defaultPadding, policyScope, at],
  );
  const row = rows[0];
  return formatDocumentNumber({
    prefix: row.effective_prefix ?? defaultPrefix,
    padding: Number(row.effective_padding ?? defaultPadding),
    value: row.allocated_value,
    periodLabel: row.period_label ?? null,
  });
}

// ---------------------------------------------------------------- Settings

function configurableType(documentType) {
  const definition = getDocumentType(documentType);
  if (!definition || definition.family) throw new DocumentNumberError(400, "This document type is not numbered by the platform.", "DOCUMENT_NUMBER_TYPE_UNREGISTERED");
  if (!definition.configurable) throw new DocumentNumberError(409, "This document type's numbering is managed in its module's own settings.", "DOCUMENT_NUMBER_MODULE_MANAGED");
  return definition;
}

async function assertCompany(client, organizationId, companyId) {
  if (!UUID.test(String(companyId || ""))) throw new DocumentNumberError(400, "Choose a company.", "DOCUMENT_NUMBER_COMPANY_REQUIRED");
  const { rows } = await client.query(`SELECT id FROM public.companies WHERE organization_id=$1 AND id=$2`, [organizationId, companyId]);
  if (!rows[0]) throw new DocumentNumberError(404, "Company not found.", "DOCUMENT_NUMBER_COMPANY_REQUIRED");
}

// Per company: every registered type with its effective format and the next
// number the current period will issue (informational).
export async function getNumberingOverview(client, organizationId, companyId, { at = new Date() } = {}) {
  await assertCompany(client, organizationId, companyId);
  const policies = (
    await client.query(`SELECT * FROM tenant.document_numbering_policies WHERE organization_id=$1 AND status='active' AND (company_id IS NULL OR company_id=$2)`, [organizationId, companyId])
  ).rows;
  const counters = (
    await client.query(`SELECT company_id, document_type, period_key, next_value FROM tenant.document_sequences WHERE organization_id=$1 AND company_id = ANY($2::uuid[])`, [organizationId, [organizationId, companyId]])
  ).rows;
  const { rows: orgRows } = await client.query(`SELECT fiscal_year_start_month FROM public.organizations WHERE id=$1`, [organizationId]);
  const startMonth = Number(orgRows[0]?.fiscal_year_start_month || 4);
  const types = [];
  for (const definition of DOCUMENT_TYPES) {
    if (definition.family) continue;
    const counterCompany = definition.scope === "organization" ? organizationId : companyId;
    const policy = policies.find((row) => row.document_type === definition.key && (definition.scope === "organization" ? row.company_id === null : row.company_id === companyId)) || null;
    const resetPolicy = policy?.reset_policy ?? "never";
    const period =
      resetPolicy === "calendar_year" ? { key: `cy${at.getUTCFullYear()}`, label: String(at.getUTCFullYear()) }
      : resetPolicy === "fiscal_year" ? (() => { const fy = fiscalYearFor(at, startMonth); return { key: `fy${fy.startYear}`, label: fy.label }; })()
      : { key: "global", label: null };
    const counter = counters.find((row) => row.company_id === counterCompany && row.document_type === definition.key && row.period_key === period.key);
    const prefix = policy?.prefix ?? definition.defaultPrefix;
    const padding = Number(policy?.padding ?? definition.defaultPadding);
    const nextValue = Number(counter?.next_value ?? 1);
    types.push({
      documentType: definition.key,
      label: definition.label,
      moduleKey: definition.moduleKey,
      scope: definition.scope,
      configurable: definition.configurable,
      customized: Boolean(policy),
      prefix,
      padding,
      resetPolicy,
      version: policy?.version ?? 0,
      nextValue,
      nextNumberPreview: formatDocumentNumber({ prefix, padding, value: nextValue, periodLabel: period.label }),
    });
  }
  return { companyId, fiscalYearStartMonth: startMonth, types };
}

export async function setNumberingPolicy(client, session, input) {
  const definition = configurableType(input.documentType);
  const companyId = definition.scope === "organization" ? null : String(input.companyId || "");
  if (companyId) await assertCompany(client, session.organizationId, companyId);
  const prefix = String(input.prefix ?? "").trim().toUpperCase();
  if (!PREFIX.test(prefix)) throw new DocumentNumberError(400, "Use 1–24 capital letters, digits, '-', '/' or '_' for the prefix.", "DOCUMENT_NUMBER_PREFIX_INVALID");
  const padding = Number(input.padding);
  if (!Number.isInteger(padding) || padding < 1 || padding > 12) throw new DocumentNumberError(400, "Digits must be between 1 and 12.", "DOCUMENT_NUMBER_PADDING_INVALID");
  const resetPolicy = String(input.resetPolicy || "never");
  if (!RESET_POLICIES.includes(resetPolicy)) throw new DocumentNumberError(400, "Unsupported reset policy.", "DOCUMENT_NUMBER_RESET_INVALID");
  const expectedVersion = input.expectedVersion === undefined || input.expectedVersion === null ? null : Number(input.expectedVersion);

  const current = (
    await client.query(
      `SELECT * FROM tenant.document_numbering_policies WHERE organization_id=$1 AND document_type=$2 AND (($3::uuid IS NULL AND company_id IS NULL) OR company_id=$3::uuid) FOR UPDATE`,
      [session.organizationId, definition.key, companyId],
    )
  ).rows[0];
  if (expectedVersion !== null && Number(current?.version ?? 0) !== expectedVersion) {
    throw new DocumentNumberError(409, "Someone else changed this numbering policy. Reload and try again.", "DOCUMENT_NUMBER_VERSION_CONFLICT");
  }
  const saved = current
    ? (
        await client.query(
          `UPDATE tenant.document_numbering_policies SET prefix=$2, padding=$3, reset_policy=$4, status='active', version=version+1, updated_by=$5, updated_at=now() WHERE id=$1 RETURNING *`,
          [current.id, prefix, padding, resetPolicy, session.userId],
        )
      ).rows[0]
    : (
        await client.query(
          `INSERT INTO tenant.document_numbering_policies (organization_id, company_id, document_type, prefix, padding, reset_policy, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [session.organizationId, companyId, definition.key, prefix, padding, resetPolicy, session.userId],
        )
      ).rows[0];
  await audit(client, {
    organizationId: session.organizationId,
    actorUserId: session.userId,
    eventType: "numbering.policy_changed",
    entityType: "numbering_policy",
    entityId: saved.id,
    metadata: { documentType: definition.key, companyId },
    beforeData: current ? { prefix: current.prefix, padding: current.padding, resetPolicy: current.reset_policy } : null,
    afterData: { prefix, padding, resetPolicy },
  });
  return { documentType: definition.key, companyId, prefix, padding, resetPolicy, version: saved.version };
}

// Moves a counter FORWARD only (e.g. to skip past numbers issued by a
// previous system). Lowering is impossible: it could re-issue an identifier.
export async function advanceNumberingCounter(client, session, input) {
  const definition = configurableType(input.documentType);
  const companyId = definition.scope === "organization" ? session.organizationId : String(input.companyId || "");
  if (definition.scope === "company") await assertCompany(client, session.organizationId, companyId);
  const nextValue = Number(input.nextValue);
  if (!Number.isSafeInteger(nextValue) || nextValue < 1) throw new DocumentNumberError(400, "Enter a whole number.", "DOCUMENT_NUMBER_VALUE_INVALID");
  const policy = await loadPolicy(client, session.organizationId, companyId, definition);
  const period = await periodFor(client, session.organizationId, policy?.reset_policy ?? "never", new Date());
  const existing = (
    await client.query(
      `SELECT next_value FROM tenant.document_sequences WHERE organization_id=$1 AND company_id=$2 AND document_type=$3 AND period_key=$4 FOR UPDATE`,
      [session.organizationId, companyId, definition.key, period.key],
    )
  ).rows[0];
  const current = Number(existing?.next_value ?? 1);
  if (nextValue <= current) {
    throw new DocumentNumberError(409, `The next number is already ${current}. Numbers can only move forward, so an issued number is never reused.`, "DOCUMENT_NUMBER_DECREMENT_REFUSED");
  }
  await client.query(
    `INSERT INTO tenant.document_sequences (organization_id,company_id,document_type,period_key,prefix,padding,next_value)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (organization_id,company_id,document_type,period_key) DO UPDATE SET next_value=GREATEST(tenant.document_sequences.next_value, EXCLUDED.next_value), updated_at=now()`,
    [session.organizationId, companyId, definition.key, period.key, policy?.prefix ?? definition.defaultPrefix, Number(policy?.padding ?? definition.defaultPadding), nextValue],
  );
  await audit(client, {
    organizationId: session.organizationId,
    actorUserId: session.userId,
    eventType: "numbering.counter_advanced",
    entityType: "numbering_policy",
    entityId: definition.key,
    metadata: { documentType: definition.key, companyId: definition.scope === "company" ? companyId : null, period: period.key },
    beforeData: { nextValue: current },
    afterData: { nextValue },
  });
  return { documentType: definition.key, nextValue };
}
