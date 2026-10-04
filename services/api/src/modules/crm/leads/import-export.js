// Lead import (CSV / XLSX) and export (CSV).
//
// Import is two steps, both stateless: analyze the file (headers, a suggested
// column mapping, sample rows), then import it with the confirmed mapping.
// Every row goes through createLead, so validation, duplicate detection,
// assignment rules, history and notifications behave exactly as they do for a
// lead typed in by hand. A row that fails is reported with its reason and
// never stops the rest of the file.
import { parseCsvUpload } from "../../../core/platform/data-exchange/csv.js";
import { isXlsxFileName, parseXlsxUpload } from "../../../core/platform/data-exchange/xlsx.js";
import { CrmError } from "../data-management/errors.js";
import { importDuplicateColumns } from "../duplicates/index.js";
import { requireLeadPermission } from "./access.js";
import { assertEligibleLeadAssignee } from "./assignment.js";
import { LEAD_PERMISSIONS, LEAD_PURCHASE_TIMEFRAMES, leadAssignmentMethodLabel, leadDisqualificationReasonLabel, leadQualificationStatusLabel, leadStatusLabel } from "./constants.js";
import { LEAD_SELECT, buildLeadListWhere, createLead, toLead } from "./records.js";
import { assertActiveLeadSource, findLeadSourceByName } from "./sources.js";

const IMPORT_ROW_LIMIT = 2000;
const EXPORT_ROW_LIMIT = 10000;
const TIMEFRAME_BY_LABEL = new Map(LEAD_PURCHASE_TIMEFRAMES.flatMap((entry) => [[entry.label.toLowerCase(), entry.code], [entry.code, entry.code]]));
const TIMEFRAME_LABELS = new Map(LEAD_PURCHASE_TIMEFRAMES.map((entry) => [entry.code, entry.label]));

// Importable fields, in template order. `aliases` are other header spellings
// the column mapping recognizes automatically.
export const LEAD_IMPORT_FIELDS = Object.freeze([
  { key: "firstName", label: "First Name", aliases: ["first", "given name"], sample: "Asha" },
  { key: "lastName", label: "Last Name", aliases: ["last", "surname", "family name"], sample: "Rao" },
  { key: "companyName", label: "Company", aliases: ["company name", "organization", "organisation", "account"], sample: "Rao Textiles Pvt Ltd" },
  { key: "jobTitle", label: "Job Title", aliases: ["title", "designation"], sample: "Purchase Manager" },
  { key: "email", label: "Email", aliases: ["email address", "e-mail"], sample: "asha.rao@example.com" },
  { key: "phone", label: "Phone", aliases: ["telephone", "office phone", "work phone"], sample: "022 4000 1234" },
  { key: "mobile", label: "Mobile", aliases: ["mobile number", "cell", "cell phone"], sample: "+91 98200 12345" },
  { key: "website", label: "Website", aliases: ["url", "web"], sample: "https://raotextiles.example" },
  { key: "city", label: "City", aliases: ["town"], sample: "Mumbai" },
  { key: "state", label: "State", aliases: ["province", "region"], sample: "Maharashtra" },
  { key: "countryCode", label: "Country Code", aliases: ["country"], sample: "IN" },
  { key: "source", label: "Lead Source", aliases: ["source"], sample: "Referral" },
  { key: "sourceDetail", label: "Source Detail", aliases: ["campaign", "referral name", "referred by"], sample: "Referred by Mehta Fabrics" },
  { key: "industry", label: "Industry", aliases: ["sector"], sample: "Textiles" },
  { key: "productInterest", label: "Product / Service Interest", aliases: ["product interest", "interest", "product", "service"], sample: "Inventory and GST billing" },
  { key: "estimatedValue", label: "Estimated Deal Value", aliases: ["estimated value", "deal value", "value", "amount"], sample: "250000" },
  { key: "purchaseTimeframe", label: "Purchase Timeframe", aliases: ["timeframe", "timeline"], sample: "Within 3 months" },
  { key: "priority", label: "Priority", aliases: [], sample: "High" },
  { key: "rating", label: "Rating", aliases: [], sample: "Warm" },
  { key: "description", label: "Description", aliases: ["notes", "comments", "remarks"], sample: "Met at the Surat trade fair." },
  { key: "ownerEmail", label: "Owner Email", aliases: ["owner", "lead owner", "assigned to"], sample: "" },
]);

const FIELD_BY_KEY = new Map(LEAD_IMPORT_FIELDS.map((field) => [field.key, field]));
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

export function buildLeadImportTemplate() {
  return toCsv([LEAD_IMPORT_FIELDS.map((field) => field.label), LEAD_IMPORT_FIELDS.map((field) => field.sample)]);
}

function parseUpload(bytes, fileName) {
  return isXlsxFileName(fileName) ? parseXlsxUpload(bytes, { maxRows: IMPORT_ROW_LIMIT }) : parseCsvUpload(bytes, { maxRows: IMPORT_ROW_LIMIT });
}

function suggestMapping(headers) {
  const mapping = {};
  for (const header of headers) {
    const key = headerKey(header);
    const field = LEAD_IMPORT_FIELDS.find((candidate) =>
      !Object.values(mapping).includes(candidate.key) && (headerKey(candidate.label) === key || headerKey(candidate.key) === key || candidate.aliases.includes(key)));
    if (field) mapping[header] = field.key;
  }
  return mapping;
}

// Step 1: read the file and suggest how its columns map to lead fields.
export async function analyzeLeadImport(_client, context, { bytes, fileName }) {
  requireLeadPermission(context, LEAD_PERMISSIONS.import, "You do not have permission to import leads.");
  const parsed = parseUpload(bytes, fileName);
  return {
    fileName,
    headers: parsed.headers,
    rowCount: parsed.rowCount,
    sampleRows: parsed.records.slice(0, 5),
    suggestedMapping: suggestMapping(parsed.headers),
    fields: LEAD_IMPORT_FIELDS.map(({ key, label }) => ({ key, label })),
  };
}

function rowToInput(record, mapping) {
  const input = {};
  for (const [header, fieldKey] of Object.entries(mapping)) {
    if (!FIELD_BY_KEY.has(fieldKey)) continue;
    const value = String(record[header] ?? "").trim();
    if (value) input[fieldKey] = value;
  }
  if (input.priority) input.priority = input.priority.toLowerCase();
  if (input.rating) input.rating = input.rating.toLowerCase();
  if (input.estimatedValue) input.estimatedValue = input.estimatedValue.replace(/[,\s]/g, "");
  if (input.purchaseTimeframe) input.purchaseTimeframe = TIMEFRAME_BY_LABEL.get(input.purchaseTimeframe.toLowerCase()) ?? input.purchaseTimeframe;
  return input;
}

// Step 2: create the leads.
// options: mapping { header: fieldKey }, defaultSourceId, skipDuplicates (default
//          true: a duplicate row is reported, not created), and how leads get an owner:
//   assignmentMode     "file"  use the Owner Email column; a row without one gets
//                              defaultOwnerUserId, or stays unassigned
//                      "rules" ignore the column and run the assignment rules
//   invalidOwnerAction for "file": a row whose owner cannot take leads is an
//                      "error" (default) or goes to the "fallback" owner / team.
// A row is never silently given to the person running the import.
export async function importLeads(client, context, {
  bytes, fileName, mapping = {}, defaultSourceId = null, defaultOwnerUserId = null, skipDuplicates = true,
  assignmentMode = "file", invalidOwnerAction = "error",
}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.import, "You do not have permission to import leads.");
  const parsed = parseUpload(bytes, fileName);
  const unknown = Object.keys(mapping).filter((header) => !parsed.headers.includes(header));
  if (unknown.length) throw new CrmError(400, `The file has no column named "${unknown[0]}".`, "CRM_LEAD_IMPORT_MAPPING");
  if (!Object.values(mapping).some((field) => ["firstName", "lastName", "companyName"].includes(field)))
    throw new CrmError(400, "Map at least one of First Name, Last Name or Company.", "CRM_LEAD_IMPORT_MAPPING");
  if (defaultSourceId) await assertActiveLeadSource(client, context, defaultSourceId);
  if (!["file", "rules"].includes(assignmentMode)) throw new CrmError(400, "Choose how the imported leads are assigned.", "CRM_LEAD_IMPORT_ASSIGNMENT");
  const useRules = assignmentMode === "rules";
  if (defaultOwnerUserId && !useRules) await assertEligibleLeadAssignee(client, context, defaultOwnerUserId);

  // email → { id } when the user can own leads, { error } when they cannot.
  const ownerByEmail = new Map();
  const resolveOwner = async (email) => {
    const key = email.toLowerCase();
    if (!ownerByEmail.has(key)) {
      const owner = await client.query(
        `SELECT app_user.id FROM users app_user JOIN organization_memberships membership ON membership.user_id = app_user.id
          WHERE membership.organization_id = $1 AND lower(app_user.email) = $2`,
        [context.organizationId, key],
      );
      let resolved = { error: `No user has the email "${email}".` };
      if (owner.rows[0]) {
        try {
          await assertEligibleLeadAssignee(client, context, owner.rows[0].id);
          resolved = { id: owner.rows[0].id };
        } catch (error) {
          if (!(error instanceof CrmError)) throw error;
          resolved = { error: `Owner "${email}" cannot take leads: ${error.message}` };
        }
      }
      ownerByEmail.set(key, resolved);
    }
    return ownerByEmail.get(key);
  };
  const sourceByName = new Map();
  const results = [];
  for (const [index, record] of parsed.records.entries()) {
    const rowNumber = index + 2;
    const input = rowToInput(record, mapping);
    let possibleDuplicate = false;
    await client.query("SAVEPOINT lead_import_row");
    try {
      const { source, ownerEmail, ...lead } = input;
      if (source) {
        const key = source.toLowerCase();
        if (!sourceByName.has(key)) sourceByName.set(key, await findLeadSourceByName(client, context, source));
        if (!sourceByName.get(key)) throw new CrmError(400, `Lead source "${source}" does not exist.`, "CRM_LEAD_IMPORT_SOURCE");
        lead.sourceId = sourceByName.get(key);
      } else if (defaultSourceId) lead.sourceId = defaultSourceId;

      let routing = useRules ? "rules" : "none";
      let assignmentReason = null;
      if (!useRules && ownerEmail) {
        const owner = await resolveOwner(ownerEmail);
        if (owner.id) lead.ownerUserId = owner.id;
        else if (invalidOwnerAction === "fallback") { routing = "fallback"; assignmentReason = owner.error; }
        else throw new CrmError(400, owner.error, "CRM_LEAD_IMPORT_OWNER");
      } else if (!useRules && defaultOwnerUserId) lead.ownerUserId = defaultOwnerUserId;

      const created = await createLead(client, context, lead, {
        allowDuplicate: !skipDuplicates, duplicateReason: "Imported with Create anyway", origin: "import",
        onDuplicateCheck: (found) => { possibleDuplicate = found.matches.length > 0; }, routing, assignmentReason ,
      });
      await client.query("RELEASE SAVEPOINT lead_import_row");
      results.push({ row: rowNumber, ok: true, possibleDuplicate, leadId: created.id, code: created.code, assigned: Boolean(created.ownerUserId), fellBack: routing === "fallback" });
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT lead_import_row");
      if (!(error instanceof CrmError)) throw error;
      const duplicate = error.code === "CRM_LEAD_DUPLICATE";
      const match = duplicate ? error.details?.matches?.[0] : null;
      results.push({
        row: rowNumber,
        ok: false,
        duplicate,
        message: duplicate ? `Duplicate of an existing ${match?.kind ?? "record"}${match?.code ? ` (${match.code})` : match?.name ? ` (${match.name})` : ""}.` : error.message,
        data: record,
        ...importDuplicateColumns(match),
      });
    }
  }

  const failed = results.filter((entry) => !entry.ok);
  return {
    total: results.length,
    created: results.length - failed.length,
    assigned: results.filter((entry) => entry.ok && entry.assigned).length,
    unassigned: results.filter((entry) => entry.ok && !entry.assigned).length,
    ownerFallbacks: results.filter((entry) => entry.ok && entry.fellBack).length,
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
  ["Lead Number", (lead) => lead.code],
  ["First Name", (lead) => lead.firstName],
  ["Last Name", (lead) => lead.lastName],
  ["Company", (lead) => lead.companyName],
  ["Job Title", (lead) => lead.jobTitle],
  ["Email", (lead) => lead.email],
  ["Phone", (lead) => lead.phone],
  ["Mobile", (lead) => lead.mobile],
  ["Website", (lead) => lead.website],
  ["City", (lead) => lead.city],
  ["State", (lead) => lead.state],
  ["Country Code", (lead) => lead.countryCode],
  ["Lead Source", (lead) => lead.sourceName],
  ["Source Detail", (lead) => lead.sourceDetail],
  ["Industry", (lead) => lead.industry],
  ["Product / Service Interest", (lead) => lead.productInterest],
  ["Estimated Deal Value", (lead) => lead.estimatedValue],
  ["Currency", (lead) => lead.currencyCode],
  ["Purchase Timeframe", (lead) => TIMEFRAME_LABELS.get(lead.purchaseTimeframe) ?? ""],
  ["Priority", (lead) => lead.priority],
  ["Rating", (lead) => lead.rating],
  ["Stage", (lead) => lead.stageName],
  ["Stage Entered At", (lead) => lead.stageChangedAt],
  ["Status", (lead) => leadStatusLabel(lead.status)],
  ["Qualification", (lead) => leadQualificationStatusLabel(lead.qualificationStatus)],
  ["Qualified At", (lead) => lead.qualifiedAt],
  ["Disqualification Reason", (lead) => (lead.disqualificationReason ? leadDisqualificationReasonLabel(lead.disqualificationReason) : "")],
  ["Owner", (lead) => lead.ownerName],
  ["Team", (lead) => lead.teamName],
  ["Assigned At", (lead) => lead.assignedAt],
  ["Assignment Method", (lead) => (lead.assignmentMethod ? leadAssignmentMethodLabel(lead.assignmentMethod) : "")],
  ["Tags", (lead) => lead.tags.map((tag) => tag.name).join("; ")],
  ["Next Follow-up", (lead) => lead.nextFollowUpAt],
  ["Last Activity", (lead) => lead.lastActivityAt],
  ["Created By", (lead) => lead.createdByName],
  ["Created At", (lead) => lead.createdAt],
  ["Updated At", (lead) => lead.updatedAt],
  ["Converted At", (lead) => lead.convertedAt],
  ["Description", (lead) => lead.description],
]);

// Exports exactly the leads the list shows for the same view and filters.
export async function exportLeads(client, context, filters = {}) {
  requireLeadPermission(context, LEAD_PERMISSIONS.export, "You do not have permission to export leads.");
  requireLeadPermission(context, LEAD_PERMISSIONS.viewSensitive, "You do not have permission to export lead contact details.");
  const values = [];
  const where = buildLeadListWhere(context, filters, values);
  const { rows } = await client.query(`${LEAD_SELECT} ${where} ORDER BY lead.created_at DESC, lead.id DESC LIMIT ${EXPORT_ROW_LIMIT + 1}`, values);
  if (rows.length > EXPORT_ROW_LIMIT)
    throw new CrmError(413, `This export has more than ${EXPORT_ROW_LIMIT} leads. Narrow the filters and try again.`, "CRM_LEAD_EXPORT_TOO_LARGE");
  const leads = rows.map(toLead);
  return {
    fileName: `leads-${new Date().toISOString().slice(0, 10)}.csv`,
    rowCount: leads.length,
    csv: toCsv([EXPORT_COLUMNS.map(([label]) => label), ...leads.map((lead) => EXPORT_COLUMNS.map(([, read]) => read(lead)))]),
  };
}
