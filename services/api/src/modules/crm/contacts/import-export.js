// Contact import (CSV / XLSX) and export (CSV).
//
// Import is two steps, both stateless: analyze the file (headers, a suggested
// column mapping, sample rows), then import it with the confirmed mapping.
// Every row goes through createContact, so validation, duplicate detection,
// ownership, history and notifications behave exactly as for a contact typed
// in by hand. The Company column is matched against existing accounts by
// normalized name ("ABC Pvt Ltd" finds "ABC Private Limited"); a company that
// is not found is reported and the person is imported without one.
import { parseCsvUpload } from "../../../core/platform/data-exchange/csv.js";
import { isXlsxFileName, parseXlsxUpload } from "../../../core/platform/data-exchange/xlsx.js";
import { accountScopeSql } from "../accounts/access.js";
import { CrmError } from "../data-management/errors.js";
import { importDuplicateColumns } from "../duplicates/index.js";
import { assertEligibleLeadAssignee as assertEligibleMember } from "../leads/assignment.js";
import { findLeadSourceByName } from "../leads/sources.js";
import { requireContactPermission } from "./access.js";
import { CONTACT_PERMISSIONS, CONTACT_ROLES, PREFERRED_CONTACT_METHODS, contactStatusLabel } from "./constants.js";
import { CONTACT_SELECT, buildContactListWhere, createContact, toContact } from "./records.js";

const IMPORT_ROW_LIMIT = 2000;
const EXPORT_ROW_LIMIT = 10000;
const ROLE_BY_LABEL = new Map(CONTACT_ROLES.flatMap((entry) => [[entry.label.toLowerCase(), entry.code], [entry.code, entry.code]]));
const METHOD_BY_LABEL = new Map(PREFERRED_CONTACT_METHODS.flatMap((entry) => [[entry.label.toLowerCase(), entry.code], [entry.code, entry.code]]));

export const CONTACT_IMPORT_FIELDS = Object.freeze([
  { key: "firstName", label: "First Name", aliases: ["first", "given name"], sample: "Rahul" },
  { key: "middleName", label: "Middle Name", aliases: ["middle"], sample: "" },
  { key: "lastName", label: "Last Name", aliases: ["last", "surname", "family name"], sample: "Sharma" },
  { key: "fullName", label: "Name", aliases: ["full name", "contact name", "contact"], sample: "" },
  { key: "company", label: "Company", aliases: ["company name", "account", "account name", "organization", "organisation"], sample: "ABC Manufacturing" },
  { key: "jobTitle", label: "Job Title", aliases: ["title", "designation", "position"], sample: "Procurement Head" },
  { key: "department", label: "Department", aliases: ["dept"], sample: "Procurement" },
  { key: "role", label: "Role", aliases: ["contact role"], sample: "Decision Maker" },
  { key: "email", label: "Work Email", aliases: ["email", "email address", "e-mail"], sample: "rahul@abc.example" },
  { key: "secondaryEmail", label: "Secondary Email", aliases: ["personal email", "other email"], sample: "" },
  { key: "phone", label: "Work Phone", aliases: ["phone", "office phone", "telephone"], sample: "022 4000 1234" },
  { key: "mobile", label: "Mobile", aliases: ["mobile number", "cell", "cell phone"], sample: "+91 98200 12345" },
  { key: "alternatePhone", label: "Alternate Phone", aliases: ["other phone"], sample: "" },
  { key: "preferredContactMethod", label: "Preferred Contact Method", aliases: ["preferred method"], sample: "Mobile" },
  { key: "city", label: "City", aliases: ["town"], sample: "" },
  { key: "state", label: "State", aliases: ["province", "region"], sample: "" },
  { key: "countryCode", label: "Country Code", aliases: ["country"], sample: "" },
  { key: "source", label: "Source", aliases: ["lead source"], sample: "Referral" },
  { key: "description", label: "Description", aliases: ["notes", "comments", "remarks"], sample: "" },
  { key: "ownerEmail", label: "Owner Email", aliases: ["owner", "contact owner", "assigned to"], sample: "" },
]);

const FIELD_BY_KEY = new Map(CONTACT_IMPORT_FIELDS.map((field) => [field.key, field]));
const headerKey = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function csvCell(value) {
  let cell = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

function toCsv(rows) {
  return `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function buildContactImportTemplate() {
  return toCsv([CONTACT_IMPORT_FIELDS.map((field) => field.label), CONTACT_IMPORT_FIELDS.map((field) => field.sample)]);
}

function parseUpload(bytes, fileName) {
  return isXlsxFileName(fileName) ? parseXlsxUpload(bytes, { maxRows: IMPORT_ROW_LIMIT }) : parseCsvUpload(bytes, { maxRows: IMPORT_ROW_LIMIT });
}

function suggestMapping(headers) {
  const mapping = {};
  for (const header of headers) {
    const key = headerKey(header);
    const field = CONTACT_IMPORT_FIELDS.find((candidate) =>
      !Object.values(mapping).includes(candidate.key) && (headerKey(candidate.label) === key || headerKey(candidate.key) === key || candidate.aliases.includes(key)));
    if (field) mapping[header] = field.key;
  }
  return mapping;
}

export async function analyzeContactImport(_client, context, { bytes, fileName }) {
  requireContactPermission(context, CONTACT_PERMISSIONS.import, "You do not have permission to import contacts.");
  const parsed = parseUpload(bytes, fileName);
  return {
    fileName,
    headers: parsed.headers,
    rowCount: parsed.rowCount,
    sampleRows: parsed.records.slice(0, 5),
    suggestedMapping: suggestMapping(parsed.headers),
    fields: CONTACT_IMPORT_FIELDS.map(({ key, label }) => ({ key, label })),
  };
}

function rowToInput(record, mapping) {
  const input = {};
  for (const [header, fieldKey] of Object.entries(mapping)) {
    if (!FIELD_BY_KEY.has(fieldKey)) continue;
    const value = String(record[header] ?? "").trim();
    if (value) input[fieldKey] = value;
  }
  // "Name" alone is split into first and last name.
  if (input.fullName && !input.firstName && !input.lastName) {
    const parts = input.fullName.split(/\s+/);
    input.firstName = parts.shift();
    if (parts.length) input.lastName = parts.join(" ");
  }
  delete input.fullName;
  if (input.role) input.role = ROLE_BY_LABEL.get(input.role.toLowerCase()) ?? input.role.toLowerCase();
  if (input.preferredContactMethod) input.preferredContactMethod = METHOD_BY_LABEL.get(input.preferredContactMethod.toLowerCase()) ?? input.preferredContactMethod.toLowerCase();
  return input;
}

// One visible, non-archived account whose normalized name matches.
async function matchAccount(client, context, name) {
  const values = [context.organizationId, name];
  const { rows } = await client.query(
    `SELECT account.id FROM tenant.business_parties account
      WHERE account.organization_id = $1 AND account.party_type <> 'supplier' AND account.status <> 'archived'
        AND (account.normalized_company_name = tenant.crm_normalize_company_name($2) OR account.normalized_legal_company_name = tenant.crm_normalize_company_name($2))
        ${accountScopeSql(context, values, "account")}
      LIMIT 2`,
    values,
  );
  return rows.length === 1 ? rows[0].id : rows.length > 1 ? "ambiguous" : null;
}

// options: mapping { header: fieldKey }, defaultSourceId, defaultOwnerUserId,
//          skipDuplicates (default true: a duplicate row is reported, not created)
export async function importContacts(client, context, { bytes, fileName, mapping = {}, defaultSourceId = null, defaultOwnerUserId = null, skipDuplicates = true }) {
  requireContactPermission(context, CONTACT_PERMISSIONS.import, "You do not have permission to import contacts.");
  requireContactPermission(context, CONTACT_PERMISSIONS.create, "You do not have permission to create contacts.");
  const parsed = parseUpload(bytes, fileName);
  const unknown = Object.keys(mapping).filter((header) => !parsed.headers.includes(header));
  if (unknown.length) throw new CrmError(400, `The file has no column named "${unknown[0]}".`, "CRM_CONTACT_IMPORT_MAPPING");
  if (!Object.values(mapping).some((field) => field === "firstName" || field === "fullName"))
    throw new CrmError(400, "Map the First Name or Name column.", "CRM_CONTACT_IMPORT_MAPPING");
  if (defaultOwnerUserId) await assertEligibleMember(client, context, defaultOwnerUserId);

  const ownerByEmail = new Map();
  const sourceByName = new Map();
  const accountByName = new Map();
  const results = [];
  for (const [index, record] of parsed.records.entries()) {
    const rowNumber = index + 2;
    const input = rowToInput(record, mapping);
    let possibleDuplicate = false;
    await client.query("SAVEPOINT contact_import_row");
    try {
      const { source, ownerEmail, company, ...contact } = input;
      let warning = null;
      if (company) {
        const key = company.toLowerCase();
        if (!accountByName.has(key)) accountByName.set(key, await matchAccount(client, context, company));
        const match = accountByName.get(key);
        if (match === "ambiguous") warning = `More than one account is called "${company}"; imported without a company.`;
        else if (match) contact.accountId = match;
        else warning = `No account called "${company}"; imported without a company.`;
      }
      if (source) {
        const key = source.toLowerCase();
        if (!sourceByName.has(key)) sourceByName.set(key, await findLeadSourceByName(client, context, source));
        if (!sourceByName.get(key)) throw new CrmError(400, `Source "${source}" does not exist.`, "CRM_CONTACT_IMPORT_SOURCE");
        contact.sourceId = sourceByName.get(key);
      } else if (defaultSourceId) contact.sourceId = defaultSourceId;
      if (ownerEmail) {
        const key = ownerEmail.toLowerCase();
        if (!ownerByEmail.has(key)) {
          const owner = await client.query(
            `SELECT app_user.id FROM users app_user JOIN organization_memberships membership ON membership.user_id = app_user.id
              WHERE membership.organization_id = $1 AND membership.status = 'active' AND app_user.status = 'active' AND lower(app_user.email) = $2`,
            [context.organizationId, key],
          );
          ownerByEmail.set(key, owner.rows[0]?.id ?? null);
        }
        if (!ownerByEmail.get(key)) throw new CrmError(400, `No active user has the email "${ownerEmail}".`, "CRM_CONTACT_IMPORT_OWNER");
        contact.ownerUserId = ownerByEmail.get(key);
      } else if (defaultOwnerUserId) contact.ownerUserId = defaultOwnerUserId;

      const created = await createContact(client, context, contact, {
        allowDuplicate: !skipDuplicates, duplicateReason: "Imported with Create anyway", origin: "import",
        onDuplicateCheck: (found) => { possibleDuplicate = found.matches.length > 0; } ,
      });
      await client.query("RELEASE SAVEPOINT contact_import_row");
      results.push({ row: rowNumber, ok: true, possibleDuplicate, contactId: created.id, code: created.contactNumber, warning });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT contact_import_row");
      if (!(error instanceof CrmError)) throw error;
      const duplicate = error.code === "CRM_CONTACT_DUPLICATE";
      const match = duplicate ? error.details?.matches?.[0] : null;
      results.push({
        row: rowNumber,
        ok: false,
        duplicate,
        message: duplicate ? `Duplicate of ${match?.name ?? "an existing contact"}${match?.code ? ` (${match.code})` : ""}.` : error.message,
        data: record,
        ...importDuplicateColumns(match),
      });
    }
  }

  const failed = results.filter((entry) => !entry.ok);
  return {
    total: results.length,
    created: results.length - failed.length,
    failed: failed.length,
    duplicates: failed.filter((entry) => entry.duplicate).length,
    // created, but similar to an existing record: worth a look in the duplicate review
    possibleDuplicates: results.filter((entry) => entry.ok && entry.possibleDuplicate).length,
    invalid: failed.filter((entry) => !entry.duplicate).length,
    errors: failed.map(({ row, message, duplicate, matchingRecord, matchField }) => ({ row, message, duplicate, matchingRecord, matchField })),
    warnings: results.filter((entry) => entry.ok && entry.warning).map(({ row, warning }) => ({ row, message: warning })),
    errorCsv: failed.length ? toCsv([[...parsed.headers, "Row", "Reason", "Matching Record", "Match Field"],
      ...failed.map((entry) => [...parsed.headers.map((header) => entry.data[header] ?? ""), entry.row, entry.message, entry.matchingRecord ?? "", entry.matchField ?? ""])]) : null,
  };
}

// ------------------------------------------------------------------ export

const EXPORT_COLUMNS = Object.freeze([
  ["Contact Number", (contact) => contact.contactNumber],
  ["First Name", (contact) => contact.firstName],
  ["Middle Name", (contact) => contact.middleName],
  ["Last Name", (contact) => contact.lastName],
  ["Display Name", (contact) => contact.displayName],
  ["Company", (contact) => contact.accountName],
  ["Job Title", (contact) => contact.jobTitle],
  ["Department", (contact) => contact.department],
  ["Role", (contact) => contact.roleLabel],
  ["Decision Maker", (contact) => (contact.isDecisionMaker ? "Yes" : "No")],
  ["Primary Contact", (contact) => (contact.isPrimary ? "Yes" : "No")],
  ["Work Email", (contact) => contact.email],
  ["Secondary Email", (contact) => contact.secondaryEmail],
  ["Work Phone", (contact) => contact.phone],
  ["Mobile", (contact) => contact.mobile],
  ["Alternate Phone", (contact) => contact.alternatePhone],
  ["Preferred Contact Method", (contact) => contact.preferredContactMethod],
  ["Do Not Email", (contact) => (contact.doNotEmail ? "Yes" : "No")],
  ["Do Not Call", (contact) => (contact.doNotCall ? "Yes" : "No")],
  ["Status", (contact) => contactStatusLabel(contact.status)],
  ["Source", (contact) => contact.sourceName],
  ["Owner", (contact) => contact.ownerName],
  ["Team", (contact) => contact.teamName],
  ["Tags", (contact) => contact.tags.map((tag) => tag.name).join("; ")],
  ["Last Activity", (contact) => contact.lastActivityAt],
  ["Next Follow-up", (contact) => contact.nextFollowUpAt],
  ["Created At", (contact) => contact.createdAt],
  ["Updated At", (contact) => contact.updatedAt],
]);

export async function exportContacts(client, context, filters = {}) {
  requireContactPermission(context, CONTACT_PERMISSIONS.export, "You do not have permission to export contacts.");
  requireContactPermission(context, CONTACT_PERMISSIONS.viewSensitive, "You do not have permission to export contact details.");
  const values = [];
  const where = buildContactListWhere(context, filters, values);
  const { rows } = await client.query(`${CONTACT_SELECT} ${where} ORDER BY lower(contact.first_name), contact.id LIMIT ${EXPORT_ROW_LIMIT + 1}`, values);
  if (rows.length > EXPORT_ROW_LIMIT)
    throw new CrmError(413, `This export has more than ${EXPORT_ROW_LIMIT} contacts. Narrow the filters and try again.`, "CRM_CONTACT_EXPORT_TOO_LARGE");
  const contacts = rows.map(toContact);
  return {
    fileName: `contacts-${new Date().toISOString().slice(0, 10)}.csv`,
    rowCount: contacts.length,
    csv: toCsv([EXPORT_COLUMNS.map(([label]) => label), ...contacts.map((contact) => EXPORT_COLUMNS.map(([, read]) => read(contact)))]),
  };
}
