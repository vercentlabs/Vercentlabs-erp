// Deal import (CSV / XLSX) — CRM plan 2.5, so a business moving in from spreadsheets or another CRM brings its open deals (and, if it
// wishes, the ones it already won or lost) instead of retyping them.
//
// Two steps, as for leads, companies and contacts: analyze the file (headers, a suggested mapping, sample rows), then import with the
// confirmed mapping. Every row goes through createOpportunity — the same validation, numbering, ownership and history as a deal typed in
// by hand — and a Won or Lost row is then closed through markOpportunityWon / markOpportunityLost with its reason, so the win/loss
// report counts it. The company is found by its number or name; a row naming a company that does not exist is refused unless the import
// is asked to create missing companies. A failed row is reported with its reason and never stops the rest of the file.
import { withMigrationAliases } from "../data-management/migration-presets.js";
import { parseCsvUpload } from "../../../core/platform/data-exchange/csv.js";
import { isXlsxFileName, parseXlsxUpload } from "../../../core/platform/data-exchange/xlsx.js";
import { accountScopeSql } from "../accounts/access.js";
import { createAccount } from "../accounts/records.js";
import { listCloseReasons } from "../close-reasons/index.js";
import { CrmError } from "../data-management/errors.js";
import { findLeadSourceByName } from "../leads/sources.js";
import { requireOpportunityPermission } from "./access.js";
import { OPPORTUNITY_PERMISSIONS } from "./constants.js";
import { markOpportunityLost, markOpportunityWon } from "./outcome.js";
import { createOpportunity } from "./records.js";

export const IMPORT_ROW_LIMIT = 2000;

// With the column names other tools export (CRM plan 5.7: moving in from Zoho, HubSpot, Salesforce, Odoo…).
export const OPPORTUNITY_IMPORT_FIELDS = withMigrationAliases("opportunities", [
  { key: "name", label: "Deal Name", aliases: ["deal", "opportunity", "opportunity name", "name", "title", "subject"], sample: "Mehta Fabrics — ERP rollout" },
  { key: "company", label: "Company", aliases: ["account", "account name", "company name", "customer", "organisation", "organization"], sample: "Mehta Fabrics" },
  { key: "contactEmail", label: "Contact Email", aliases: ["contact", "email", "contact e-mail", "primary contact email"], sample: "rahul@mehtafabrics.example" },
  { key: "amount", label: "Value", aliases: ["amount", "deal value", "estimated value", "expected revenue", "value inr"], sample: "450000" },
  { key: "currencyCode", label: "Currency", aliases: ["currency code"], sample: "INR" },
  { key: "stage", label: "Stage", aliases: ["deal stage", "sales stage", "pipeline stage"], sample: "Proposal" },
  { key: "expectedCloseDate", label: "Expected Close Date", aliases: ["close date", "closing date", "expected close", "deadline"], sample: "2026-12-15" },
  { key: "priority", label: "Priority", aliases: [], sample: "Medium" },
  { key: "source", label: "Source", aliases: ["lead source", "deal source"], sample: "Referral" },
  { key: "productInterest", label: "Product / Service", aliases: ["product", "products", "service", "interest", "product interest"], sample: "ERP licences" },
  { key: "description", label: "Description", aliases: ["notes", "comments", "remarks", "details"], sample: "" },
  { key: "ownerEmail", label: "Owner Email", aliases: ["owner", "salesperson", "assigned to", "deal owner"], sample: "" },
  { key: "status", label: "Status", aliases: ["outcome", "deal status", "result"], sample: "Open" },
  { key: "closedOn", label: "Closed On", aliases: ["actual close date", "won date", "lost date", "close date actual"], sample: "" },
  { key: "closeReason", label: "Won / Lost Reason", aliases: ["reason", "lost reason", "won reason", "close reason"], sample: "" },
]);

const FIELD_BY_KEY = new Map(OPPORTUNITY_IMPORT_FIELDS.map((field) => [field.key, field]));
const headerKey = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const text = (value) => String(value ?? "").trim();
const PRIORITIES = new Map([["low", "low"], ["medium", "medium"], ["normal", "medium"], ["high", "high"], ["urgent", "high"]]);
const STATUSES = new Map([["open", "open"], ["", "open"], ["in progress", "open"], ["won", "won"], ["closed won", "won"], ["lost", "lost"], ["closed lost", "lost"]]);

function csvCell(value) {
  let cell = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
const toCsv = (rows) => `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;

export function buildOpportunityImportTemplate() {
  return toCsv([OPPORTUNITY_IMPORT_FIELDS.map((field) => field.label), OPPORTUNITY_IMPORT_FIELDS.map((field) => field.sample)]);
}

function parseUpload(bytes, fileName, maxRows = IMPORT_ROW_LIMIT) {
  return isXlsxFileName(fileName) ? parseXlsxUpload(bytes, { maxRows }) : parseCsvUpload(bytes, { maxRows });
}

function suggestMapping(headers) {
  const mapping = {};
  for (const header of headers) {
    const key = headerKey(header);
    const field = OPPORTUNITY_IMPORT_FIELDS.find((candidate) =>
      !Object.values(mapping).includes(candidate.key) && (headerKey(candidate.label) === key || headerKey(candidate.key) === key || candidate.aliases.includes(key)));
    if (field) mapping[header] = field.key;
  }
  return mapping;
}

function requireImport(context) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.import, "You do not have permission to import deals.");
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.create, "You do not have permission to create deals.");
}

// Step 1: read the file and suggest how its columns map to deal fields.
export async function analyzeOpportunityImport(_client, context, { bytes, fileName, maxRows }) {
  requireImport(context);
  const parsed = parseUpload(bytes, fileName, maxRows);
  return {
    fileName, headers: parsed.headers, rowCount: parsed.rowCount, sampleRows: parsed.records.slice(0, 5), suggestedMapping: suggestMapping(parsed.headers),
    fields: OPPORTUNITY_IMPORT_FIELDS.map(({ key, label }) => ({ key, label })),
  };
}

function rowToInput(record, mapping) {
  const input = {};
  for (const [header, fieldKey] of Object.entries(mapping)) {
    if (!FIELD_BY_KEY.has(fieldKey)) continue;
    const value = text(record[header]);
    if (value) input[fieldKey] = value;
  }
  return input;
}

// A day as YYYY-MM-DD from the common ways it is written (2026-12-15, 15/12/2026, 15-12-2026, 15.12.2026).
function isoDay(value, label) {
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  throw new CrmError(400, `${label} "${raw}" is not a date: write it as 2026-12-15 or 15/12/2026.`, "CRM_OPPORTUNITY_IMPORT_VALUE");
}

// Step 2: create the deals.
// options: mapping { header: fieldKey }, createMissingCompanies (default false), defaultOwnerUserId, maxRows (the background job passes more)
export async function importOpportunities(client, context, { bytes, fileName, mapping = {}, createMissingCompanies = false, defaultOwnerUserId = null, maxRows } = {}) {
  requireImport(context);
  const parsed = parseUpload(bytes, fileName, maxRows);
  const unknown = Object.keys(mapping).filter((header) => !parsed.headers.includes(header));
  if (unknown.length) throw new CrmError(400, `The file has no column named "${unknown[0]}".`, "CRM_OPPORTUNITY_IMPORT_MAPPING");
  for (const [key, label] of [["name", "Deal Name"], ["company", "Company"]])
    if (!Object.values(mapping).includes(key)) throw new CrmError(400, `Map the ${label} column.`, "CRM_OPPORTUNITY_IMPORT_MAPPING");

  // Lookups shared by every row.
  const stages = (await client.query(
    `SELECT stage.id, lower(stage.name) AS name, lower(stage.code) AS code FROM tenant.crm_pipeline_stages stage
       JOIN tenant.crm_pipelines pipeline ON pipeline.organization_id = stage.organization_id AND pipeline.id = stage.pipeline_id AND pipeline.status = 'active'
      WHERE stage.organization_id = $1 AND stage.status = 'active' AND NOT stage.is_won AND NOT stage.is_lost ORDER BY pipeline.is_default DESC, stage.sequence`,
    [context.organizationId])).rows;
  const reasons = { won: await listCloseReasons(client, context, { outcome: "won" }), lost: await listCloseReasons(client, context, { outcome: "lost" }) };
  const cache = { company: new Map(), owner: new Map(), source: new Map(), contact: new Map() };

  async function companyFor(name) {
    const key = name.toLowerCase();
    if (cache.company.has(key)) return cache.company.get(key);
    const values = [context.organizationId, key];
    const scope = accountScopeSql(context, values, "account");
    let id = (await client.query(
      `SELECT account.id FROM tenant.business_parties account
        WHERE account.organization_id = $1 AND account.party_type <> 'supplier' AND account.status <> 'archived'
          AND (lower(account.code) = $2 OR lower(account.customer_number) = $2 OR lower(account.display_name) = $2)${scope}
        ORDER BY (lower(account.code) = $2) DESC, account.created_at LIMIT 1`, values)).rows[0]?.id ?? null;
    if (!id && createMissingCompanies) id = (await createAccount(client, context, { displayName: name }, { origin: "import", historySummary: "Company created by a deal import" })).id;
    cache.company.set(key, id);
    return id;
  }
  async function ownerFor(email) {
    const key = email.toLowerCase();
    if (!cache.owner.has(key)) cache.owner.set(key, (await client.query(
      `SELECT app_user.id FROM users app_user JOIN organization_memberships membership ON membership.user_id = app_user.id
        WHERE membership.organization_id = $1 AND membership.status = 'active' AND app_user.status = 'active' AND lower(app_user.email) = $2`,
      [context.organizationId, key])).rows[0]?.id ?? null);
    return cache.owner.get(key);
  }
  async function contactFor(email, partyId) {
    const key = `${partyId}|${email.toLowerCase()}`;
    if (!cache.contact.has(key)) cache.contact.set(key, (await client.query(
      `SELECT contact.id FROM tenant.contacts contact
        WHERE contact.organization_id = $1 AND contact.status = 'active' AND lower(contact.email) = $2
        ORDER BY (contact.party_id = $3) DESC LIMIT 1`, [context.organizationId, email.toLowerCase(), partyId])).rows[0]?.id ?? null);
    return cache.contact.get(key);
  }

  const results = [];
  for (const [index, record] of parsed.records.entries()) {
    const rowNumber = index + 2;
    const input = rowToInput(record, mapping);
    await client.query("SAVEPOINT opportunity_import_row");
    try {
      if (!input.name) throw new CrmError(400, "The deal has no name.", "CRM_OPPORTUNITY_IMPORT_VALUE");
      if (!input.company) throw new CrmError(400, "The deal has no company.", "CRM_OPPORTUNITY_IMPORT_VALUE");
      const accountId = await companyFor(input.company);
      if (!accountId) throw new CrmError(400, `No company named "${input.company}" — add it first, or import with "create missing companies".`, "CRM_OPPORTUNITY_IMPORT_COMPANY");
      const deal = { accountId, name: input.name };
      if (input.contactEmail) {
        const contactId = await contactFor(input.contactEmail, accountId);
        if (!contactId) throw new CrmError(400, `No contact has the email "${input.contactEmail}".`, "CRM_OPPORTUNITY_IMPORT_CONTACT");
        deal.contactId = contactId;
      }
      if (input.amount) {
        const amount = Number(input.amount.replace(/[,\s₹]/g, ""));
        if (!Number.isFinite(amount) || amount < 0) throw new CrmError(400, `Value "${input.amount}" is not a number.`, "CRM_OPPORTUNITY_IMPORT_VALUE");
        deal.amount = amount;
      }
      if (input.currencyCode) deal.currencyCode = input.currencyCode.toUpperCase();
      if (input.stage) {
        const key = input.stage.toLowerCase();
        const stage = stages.find((entry) => entry.name === key || entry.code === key);
        if (!stage) throw new CrmError(400, `Stage "${input.stage}" is not one of your open sales stages.`, "CRM_OPPORTUNITY_IMPORT_STAGE");
        deal.stageId = stage.id;
      }
      const close = isoDay(input.expectedCloseDate, "Expected close date");
      if (close) deal.expectedCloseDate = close;
      if (input.priority) {
        const priority = PRIORITIES.get(input.priority.toLowerCase());
        if (!priority) throw new CrmError(400, `Priority "${input.priority}" is not low, medium or high.`, "CRM_OPPORTUNITY_IMPORT_VALUE");
        deal.priority = priority;
      }
      if (input.source) {
        const key = input.source.toLowerCase();
        if (!cache.source.has(key)) cache.source.set(key, await findLeadSourceByName(client, context, input.source));
        if (!cache.source.get(key)) throw new CrmError(400, `Source "${input.source}" does not exist.`, "CRM_OPPORTUNITY_IMPORT_SOURCE");
        deal.sourceId = cache.source.get(key);
      }
      if (input.productInterest) deal.productInterest = input.productInterest;
      if (input.description) deal.description = input.description;
      if (input.ownerEmail) {
        const ownerId = await ownerFor(input.ownerEmail);
        if (!ownerId) throw new CrmError(400, `No active user has the email "${input.ownerEmail}".`, "CRM_OPPORTUNITY_IMPORT_OWNER");
        deal.ownerUserId = ownerId;
      } else if (defaultOwnerUserId) deal.ownerUserId = defaultOwnerUserId;
      const status = STATUSES.get(text(input.status).toLowerCase());
      if (!status) throw new CrmError(400, `Status "${input.status}" is not Open, Won or Lost.`, "CRM_OPPORTUNITY_IMPORT_VALUE");

      const created = await createOpportunity(client, context, deal, { origin: "import" });
      if (status !== "open") {
        const closedOn = isoDay(input.closedOn, "Closed on");
        if (!closedOn) throw new CrmError(400, `A ${status} deal needs the day it was closed.`, "CRM_OPPORTUNITY_IMPORT_VALUE");
        const wanted = text(input.closeReason).toLowerCase();
        const reason = (wanted ? reasons[status].find((entry) => entry.name.toLowerCase() === wanted || String(entry.code ?? "").toLowerCase() === wanted) : null)
          ?? (wanted ? null : reasons[status][0]);
        if (!reason) throw new CrmError(400, `"${input.closeReason}" is not one of your ${status} reasons.`, "CRM_OPPORTUNITY_IMPORT_REASON");
        const close = { reasonId: reason.id, actualCloseDate: closedOn, notes: "Imported", acknowledgeWarnings: true, openTasks: "cancel", openFollowUps: "cancel" };
        if (status === "won") await markOpportunityWon(client, context, created.id, { ...close, finalValue: deal.amount ?? undefined });
        else await markOpportunityLost(client, context, created.id, close);
      }
      await client.query("RELEASE SAVEPOINT opportunity_import_row");
      results.push({ row: rowNumber, ok: true, opportunityId: created.id, code: created.code, status });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT opportunity_import_row");
      if (!(error instanceof CrmError)) throw error;
      results.push({ row: rowNumber, ok: false, message: error.message, data: record });
    }
  }
  const failed = results.filter((entry) => !entry.ok);
  return {
    total: results.length,
    created: results.length - failed.length,
    won: results.filter((entry) => entry.ok && entry.status === "won").length,
    lost: results.filter((entry) => entry.ok && entry.status === "lost").length,
    failed: failed.length,
    errors: failed.map(({ row, message }) => ({ row, message })),
    errorCsv: failed.length ? toCsv([[...parsed.headers, "Row", "Reason"], ...failed.map((entry) => [...parsed.headers.map((header) => entry.data[header] ?? ""), entry.row, entry.message])]) : null,
  };
}
