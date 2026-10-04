// Account import (CSV / XLSX) and export (CSV).
//
// Import is two steps, both stateless: analyze the file (headers, a suggested
// column mapping, sample rows), then import it with the confirmed mapping.
// Every row goes through createAccount, so validation, duplicate detection,
// assignment, history and notifications behave exactly as they do for an
// account typed in by hand. A row with a complete address also gets that
// address as its default billing and shipping address. A row that fails is
// reported with its reason and never stops the rest of the file.
import { parseCsvUpload } from "../../../core/platform/data-exchange/csv.js";
import { isXlsxFileName, parseXlsxUpload } from "../../../core/platform/data-exchange/xlsx.js";
import { CrmError } from "../data-management/errors.js";
import { importDuplicateColumns } from "../duplicates/index.js";
import { assertEligibleLeadAssignee as assertEligibleMember } from "../leads/assignment.js";
import { findLeadSourceByName } from "../leads/sources.js";
import { requireAccountPermission } from "./access.js";
import { addAccountAddress } from "./addresses.js";
import { ACCOUNT_PERMISSIONS, ACCOUNT_TYPES, accountStatusLabel, accountTypeLabel } from "./constants.js";
import { ACCOUNT_SELECT, buildAccountListWhere, createAccount, toAccount } from "./records.js";

const IMPORT_ROW_LIMIT = 2000;
const EXPORT_ROW_LIMIT = 10000;
const TYPE_BY_LABEL = new Map(ACCOUNT_TYPES.flatMap((entry) => [[entry.label.toLowerCase(), entry.code], [entry.code, entry.code]]));
const ADDRESS_KEYS = ["line1", "line2", "city", "state", "postalCode", "countryCode"];

// Importable fields, in template order. `aliases` are other header spellings
// the column mapping recognizes automatically.
export const ACCOUNT_IMPORT_FIELDS = Object.freeze([
  { key: "displayName", label: "Account Name", aliases: ["name", "company", "company name", "account", "organization", "organisation"], sample: "Mehta Fabrics" },
  { key: "legalName", label: "Legal Name", aliases: ["registered name", "legal company name"], sample: "Mehta Fabrics Private Limited" },
  { key: "accountType", label: "Account Type", aliases: ["type"], sample: "Prospect" },
  { key: "industry", label: "Industry", aliases: ["sector"], sample: "Textiles" },
  { key: "website", label: "Website", aliases: ["url", "web"], sample: "https://mehtafabrics.example" },
  { key: "email", label: "Email", aliases: ["email address", "e-mail", "company email"], sample: "info@mehtafabrics.example" },
  { key: "phone", label: "Phone", aliases: ["telephone", "phone number", "primary phone"], sample: "+91 22 4000 5678" },
  { key: "secondaryPhone", label: "Secondary Phone", aliases: ["alternate phone", "other phone", "mobile"], sample: "" },
  { key: "employeeRange", label: "Employees", aliases: ["employee range", "company size", "employee count"], sample: "51-200" },
  { key: "annualRevenue", label: "Annual Revenue", aliases: ["revenue", "turnover"], sample: "50000000" },
  { key: "source", label: "Source", aliases: ["lead source", "account source"], sample: "Referral" },
  { key: "sourceDetail", label: "Source Detail", aliases: ["referred by", "campaign"], sample: "" },
  { key: "description", label: "Description", aliases: ["notes", "comments", "remarks"], sample: "Wholesale cotton fabrics." },
  { key: "line1", label: "Address Line 1", aliases: ["address", "street", "address 1"], sample: "12 Kalbadevi Road" },
  { key: "line2", label: "Address Line 2", aliases: ["address 2"], sample: "" },
  { key: "city", label: "City", aliases: ["town"], sample: "Mumbai" },
  { key: "state", label: "State", aliases: ["province", "region"], sample: "Maharashtra" },
  { key: "postalCode", label: "Postal Code", aliases: ["pin", "pincode", "pin code", "zip", "zip code"], sample: "400002" },
  { key: "countryCode", label: "Country Code", aliases: ["country"], sample: "IN" },
  { key: "ownerEmail", label: "Owner Email", aliases: ["owner", "account owner", "assigned to"], sample: "" },
]);

const FIELD_BY_KEY = new Map(ACCOUNT_IMPORT_FIELDS.map((field) => [field.key, field]));
const headerKey = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// A value starting with a formula character would run in a spreadsheet.
function csvCell(value) {
  let cell = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

function toCsv(rows) {
  return `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

export function buildAccountImportTemplate() {
  return toCsv([ACCOUNT_IMPORT_FIELDS.map((field) => field.label), ACCOUNT_IMPORT_FIELDS.map((field) => field.sample)]);
}

function parseUpload(bytes, fileName) {
  return isXlsxFileName(fileName) ? parseXlsxUpload(bytes, { maxRows: IMPORT_ROW_LIMIT }) : parseCsvUpload(bytes, { maxRows: IMPORT_ROW_LIMIT });
}

function suggestMapping(headers) {
  const mapping = {};
  for (const header of headers) {
    const key = headerKey(header);
    const field = ACCOUNT_IMPORT_FIELDS.find((candidate) =>
      !Object.values(mapping).includes(candidate.key) && (headerKey(candidate.label) === key || headerKey(candidate.key) === key || candidate.aliases.includes(key)));
    if (field) mapping[header] = field.key;
  }
  return mapping;
}

// Step 1: read the file and suggest how its columns map to account fields.
export async function analyzeAccountImport(_client, context, { bytes, fileName }) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.import, "You do not have permission to import accounts.");
  const parsed = parseUpload(bytes, fileName);
  return {
    fileName,
    headers: parsed.headers,
    rowCount: parsed.rowCount,
    sampleRows: parsed.records.slice(0, 5),
    suggestedMapping: suggestMapping(parsed.headers),
    fields: ACCOUNT_IMPORT_FIELDS.map(({ key, label }) => ({ key, label })),
  };
}

function rowToInput(record, mapping) {
  const input = {};
  for (const [header, fieldKey] of Object.entries(mapping)) {
    if (!FIELD_BY_KEY.has(fieldKey)) continue;
    const value = String(record[header] ?? "").trim();
    if (value) input[fieldKey] = value;
  }
  if (input.accountType) input.accountType = TYPE_BY_LABEL.get(input.accountType.toLowerCase()) ?? input.accountType.toLowerCase();
  if (input.annualRevenue) input.annualRevenue = input.annualRevenue.replace(/[,\s]/g, "");
  if (input.employeeRange) input.employeeRange = input.employeeRange.replace(/\s+/g, "");
  return input;
}

// Step 2: create the accounts.
// options: mapping { header: fieldKey }, defaultSourceId, defaultOwnerUserId,
//          skipDuplicates (default true: a duplicate row is reported, not created)
export async function importAccounts(client, context, { bytes, fileName, mapping = {}, defaultSourceId = null, defaultOwnerUserId = null, skipDuplicates = true }) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.import, "You do not have permission to import accounts.");
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.create, "You do not have permission to create accounts.");
  const parsed = parseUpload(bytes, fileName);
  const unknown = Object.keys(mapping).filter((header) => !parsed.headers.includes(header));
  if (unknown.length) throw new CrmError(400, `The file has no column named "${unknown[0]}".`, "CRM_ACCOUNT_IMPORT_MAPPING");
  if (!Object.values(mapping).includes("displayName")) throw new CrmError(400, "Map the Account Name column.", "CRM_ACCOUNT_IMPORT_MAPPING");
  if (defaultOwnerUserId) await assertEligibleMember(client, context, defaultOwnerUserId);

  const ownerByEmail = new Map();
  const sourceByName = new Map();
  const results = [];
  for (const [index, record] of parsed.records.entries()) {
    const rowNumber = index + 2;
    const input = rowToInput(record, mapping);
    let possibleDuplicate = false;
    await client.query("SAVEPOINT account_import_row");
    try {
      const { source, ownerEmail, ...rest } = input;
      const address = Object.fromEntries(ADDRESS_KEYS.filter((key) => rest[key]).map((key) => [key, rest[key]]));
      const account = Object.fromEntries(Object.entries(rest).filter(([key]) => !ADDRESS_KEYS.includes(key)));
      if (source) {
        const key = source.toLowerCase();
        if (!sourceByName.has(key)) sourceByName.set(key, await findLeadSourceByName(client, context, source));
        if (!sourceByName.get(key)) throw new CrmError(400, `Source "${source}" does not exist.`, "CRM_ACCOUNT_IMPORT_SOURCE");
        account.sourceId = sourceByName.get(key);
      } else if (defaultSourceId) account.sourceId = defaultSourceId;

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
        if (!ownerByEmail.get(key)) throw new CrmError(400, `No active user has the email "${ownerEmail}".`, "CRM_ACCOUNT_IMPORT_OWNER");
        account.ownerUserId = ownerByEmail.get(key);
      } else if (defaultOwnerUserId) account.ownerUserId = defaultOwnerUserId;

      const created = await createAccount(client, context, account, {
        allowDuplicate: !skipDuplicates, duplicateReason: "Imported with Create anyway", origin: "import",
        onDuplicateCheck: (found) => { possibleDuplicate = found.matches.length > 0; } ,
      });
      // A partial address is ignored rather than failing the row; a complete one must be valid.
      if (address.line1 && address.city && address.state && address.postalCode && address.countryCode)
        await addAccountAddress(client, context, created.id, { ...address, addressType: "office" });
      await client.query("RELEASE SAVEPOINT account_import_row");
      results.push({ row: rowNumber, ok: true, possibleDuplicate, accountId: created.id, code: created.code });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT account_import_row");
      if (!(error instanceof CrmError)) throw error;
      const duplicate = error.code === "CRM_ACCOUNT_DUPLICATE";
      const match = duplicate ? error.details?.matches?.[0] : null;
      results.push({
        row: rowNumber,
        ok: false,
        duplicate,
        message: duplicate ? `Duplicate of ${match?.name ?? "an existing account"}${match?.code ? ` (${match.code})` : ""}.` : error.message,
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
    // The failed rows as a file the user can fix and re-import.
    errorCsv: failed.length ? toCsv([[...parsed.headers, "Row", "Reason", "Matching Record", "Match Field"],
      ...failed.map((entry) => [...parsed.headers.map((header) => entry.data[header] ?? ""), entry.row, entry.message, entry.matchingRecord ?? "", entry.matchField ?? ""])]) : null,
  };
}

// ------------------------------------------------------------------ export

const EXPORT_COLUMNS = Object.freeze([
  ["Account Number", (account) => account.code],
  ["Account Name", (account) => account.displayName],
  ["Legal Name", (account) => account.legalName],
  ["Account Type", (account) => accountTypeLabel(account.accountType)],
  ["Status", (account) => accountStatusLabel(account.status)],
  ["Customer Number", (account) => account.customerNumber],
  ["Industry", (account) => account.industry],
  ["Website", (account) => account.website],
  ["Email", (account) => account.email],
  ["Phone", (account) => account.phone],
  ["Secondary Phone", (account) => account.secondaryPhone],
  ["Employees", (account) => account.employeeRange],
  ["Annual Revenue", (account) => account.annualRevenue],
  ["City", (account) => account.city],
  ["State", (account) => account.state],
  ["Country Code", (account) => account.countryCode],
  ["Parent Account", (account) => account.parentName],
  ["Source", (account) => account.sourceName],
  ["Source Detail", (account) => account.sourceDetail],
  ["Owner", (account) => account.ownerName],
  ["Team", (account) => account.teamName],
  ["Tags", (account) => account.tags.map((tag) => tag.name).join("; ")],
  ["Contacts", (account) => account.contactCount],
  ["Open Opportunities", (account) => account.openOpportunities],
  ["Open Pipeline Value", (account) => account.openPipelineValue],
  ["Next Follow-up", (account) => account.nextFollowUpAt],
  ["Last Activity", (account) => account.lastActivityAt],
  ["Created By", (account) => account.createdByName],
  ["Created At", (account) => account.createdAt],
  ["Updated At", (account) => account.updatedAt],
  ["Description", (account) => account.description],
]);

// Exports exactly the accounts the list shows for the same view and filters.
export async function exportAccounts(client, context, filters = {}) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.export, "You do not have permission to export accounts.");
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.viewSensitive, "You do not have permission to export account contact details.");
  const values = [];
  const where = buildAccountListWhere(context, filters, values);
  const { rows } = await client.query(`${ACCOUNT_SELECT} ${where} ORDER BY lower(account.display_name), account.id LIMIT ${EXPORT_ROW_LIMIT + 1}`, values);
  if (rows.length > EXPORT_ROW_LIMIT)
    throw new CrmError(413, `This export has more than ${EXPORT_ROW_LIMIT} accounts. Narrow the filters and try again.`, "CRM_ACCOUNT_EXPORT_TOO_LARGE");
  const accounts = rows.map(toAccount);
  return {
    fileName: `accounts-${new Date().toISOString().slice(0, 10)}.csv`,
    rowCount: accounts.length,
    csv: toCsv([EXPORT_COLUMNS.map(([label]) => label), ...accounts.map((account) => EXPORT_COLUMNS.map(([, read]) => read(account)))]),
  };
}
