// Importing past notes and activities (CRM plan 5.7): the calls, emails, meetings, visits and notes kept in the old tool or a sheet go onto
// the records already in CRM, dated when they happened, so a record's timeline starts with its history and not on the day of moving in.
//
// One row is one activity: Record (a lead or deal number such as LEAD-000012 or DEAL-000034, a contact's email, or a company's name or
// number), Type (call, email, meeting, visit, demo, WhatsApp, SMS, note or other), Date (and optionally time), Subject, Details, Outcome
// and By (the member's email). A note becomes a note; everything else a completed activity. Each row is kept once (a file imported again
// adds nothing twice). Rows that cannot be placed are listed with why; the others go in.
import { parseCsvUpload } from "../../../core/platform/data-exchange/csv.js";
import { isXlsxFileName, parseXlsxUpload } from "../../../core/platform/data-exchange/xlsx.js";
import { CrmError } from "./errors.js";

const LIMIT = 5000;
const TYPES = Object.freeze({
  call: "call", phone: "call", "phone call": "call", email: "email", "e mail": "email", mail: "email", meeting: "meeting", visit: "meeting", "site visit": "meeting",
  demo: "meeting", whatsapp: "whatsapp", sms: "sms", text: "sms", note: "note", notes: "note", comment: "note", other: "other", task: "other", activity: "other",
});
export const HISTORY_IMPORT_COLUMNS = Object.freeze([
  // The aliases include the headers of the other tools' activity exports (Zoho, HubSpot, Salesforce, Odoo, LeadSquared).
  { key: "record", label: "Record", aliases: ["record", "related to", "regarding", "lead", "deal", "contact", "company", "account", "record number", "record id",
    "associated contact", "associated company", "associated deal", "contact email", "lead email", "email", "email address", "related document", "parent record"], sample: "LEAD-000012" },
  { key: "type", label: "Type", aliases: ["type", "activity type", "kind", "channel", "activity event", "task subtype", "event type", "call type"], sample: "Call" },
  { key: "date", label: "Date", aliases: ["date", "activity date", "created", "created time", "when", "date time", "due date", "activity date time", "call start time",
    "start date time", "start time", "created on", "created date", "start"], sample: "2025-11-04 15:30" },
  { key: "subject", label: "Subject", aliases: ["subject", "title", "summary", "note title", "activity title"], sample: "Discussed the AMC renewal" },
  { key: "details", label: "Details", aliases: ["details", "description", "notes", "body", "content", "comments", "note", "note content", "call description",
    "activity note", "full comments"], sample: "Wants a 2-year AMC at last year's rate." },
  { key: "outcome", label: "Outcome", aliases: ["outcome", "result", "call result", "status", "disposition", "call outcome", "activity outcome"], sample: "Interested" },
  { key: "by", label: "By", aliases: ["by", "owner", "user", "created by", "activity owner", "assigned to", "owner email", "assigned", "call owner", "task owner"], sample: "" },
]);
const headerKey = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// A plain CSV with a BOM (Excel opens it as UTF-8); the sample row has no formula characters.
const quote = (value) => (/[",\r\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value));
const toCsv = (rows) => `\uFEFF${rows.map((row) => row.map(quote).join(",")).join("\r\n")}\r\n`;

export const buildHistoryImportTemplate = () => toCsv([HISTORY_IMPORT_COLUMNS.map((column) => column.label), HISTORY_IMPORT_COLUMNS.map((column) => column.sample)]);

function requireImport(context) {
  if (context.roleSlugs?.includes("organization_owner") || context.permissions?.includes("crm.import")) return;
  throw new CrmError(403, "You do not have permission to import into CRM.", "PERMISSION_DENIED");
}

function mappingOf(headers) {
  const mapping = {};
  for (const header of headers) {
    const key = headerKey(header);
    const column = HISTORY_IMPORT_COLUMNS.find((candidate) => !Object.values(mapping).includes(candidate.key)
      && (headerKey(candidate.label) === key || candidate.key === key || candidate.aliases.includes(key)));
    if (column) mapping[header] = column.key;
  }
  return mapping;
}

// "2025-11-04", "2025-11-04 15:30", "04/11/2025", "04-11-2025 3:30 PM" → an instant in the organization's time zone (SQL does the zone).
function readDate(value) {
  const text = String(value ?? "").trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(text);
  if (match) return { day: `${match[1]}-${match[2]}-${match[3]}`, time: match[4] ? `${match[4].padStart(2, "0")}:${match[5]}` : "12:00" };
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([ap]m)?)?/i.exec(text);
  if (match) {
    let hour = match[4] ? Number(match[4]) : 12;
    if (match[6]?.toLowerCase() === "pm" && hour < 12) hour += 12;
    if (match[6]?.toLowerCase() === "am" && hour === 12) hour = 0;
    return { day: `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`, time: `${String(hour).padStart(2, "0")}:${match[5] ?? "00"}` };
  }
  return null;
}

async function findRecord(client, organizationId, reference) {
  const value = String(reference ?? "").trim();
  if (!value) return null;
  const one = async (sql, params) => (await client.query(sql, params)).rows[0] ?? null;
  if (/^[A-Z][A-Z0-9]{0,9}-\d{1,12}$/i.test(value)) {
    const code = value.toUpperCase();
    return await one("SELECT 'lead' AS type, id FROM tenant.crm_leads WHERE organization_id = $1 AND code = $2", [organizationId, code])
      ?? await one("SELECT 'opportunity' AS type, id FROM tenant.crm_opportunities WHERE organization_id = $1 AND code = $2", [organizationId, code])
      ?? await one("SELECT 'contact' AS type, id FROM tenant.contacts WHERE organization_id = $1 AND upper(contact_number) = $2", [organizationId, code])
      ?? await one("SELECT 'party' AS type, id FROM tenant.business_parties WHERE organization_id = $1 AND (upper(code) = $2 OR upper(customer_number) = $2)", [organizationId, code]);
  }
  if (value.includes("@"))
    return await one("SELECT 'contact' AS type, id FROM tenant.contacts WHERE organization_id = $1 AND lower(email) = lower($2) AND status <> 'archived' ORDER BY created_at LIMIT 1", [organizationId, value])
      ?? await one("SELECT 'lead' AS type, id FROM tenant.crm_leads WHERE organization_id = $1 AND lower(email) = lower($2) ORDER BY created_at DESC LIMIT 1", [organizationId, value]);
  const companies = (await client.query("SELECT id FROM tenant.business_parties WHERE organization_id = $1 AND lower(display_name) = lower($2) AND status = 'active' LIMIT 2", [organizationId, value])).rows;
  return companies.length === 1 ? { type: "party", id: companies[0].id } : null;
}

// Reads the file and returns its columns, the mapping found and the first rows, without importing.
export function analyzeHistoryImport({ bytes, fileName }) {
  const parsed = isXlsxFileName(fileName) ? parseXlsxUpload(bytes, { maxRows: LIMIT }) : parseCsvUpload(bytes, { maxRows: LIMIT });
  return { headers: parsed.headers, mapping: mappingOf(parsed.headers), rowCount: parsed.rowCount, preview: parsed.records.slice(0, 5) };
}

// input: { bytes, fileName, mapping? } — mapping: { header: column key } (else the one found). Returns { created, notes, skipped, failed, errors }.
export async function importRecordHistory(client, context, input = {}) {
  requireImport(context);
  const parsed = isXlsxFileName(input.fileName) ? parseXlsxUpload(input.bytes, { maxRows: LIMIT }) : parseCsvUpload(input.bytes, { maxRows: LIMIT });
  const mapping = input.mapping && Object.keys(input.mapping).length ? input.mapping : mappingOf(parsed.headers);
  for (const required of ["record", "date"])
    if (!Object.values(mapping).includes(required)) throw new CrmError(400, `Map the ${required === "record" ? "Record" : "Date"} column.`, "CRM_HISTORY_IMPORT_MAPPING");
  const column = (record, key) => {
    const header = Object.keys(mapping).find((name) => mapping[name] === key);
    return header ? String(record[header] ?? "").trim() : "";
  };
  const members = new Map((await client.query(
    "SELECT lower(account.email) AS email, account.id FROM organization_memberships member JOIN users account ON account.id = member.user_id WHERE member.organization_id = $1",
    [context.organizationId])).rows.map((row) => [row.email, row.id]));
  const result = { created: 0, notes: 0, skipped: 0, failed: 0, errors: [] };
  const fileKey = String(input.fileName ?? "file").slice(0, 80);
  for (const [index, record] of parsed.records.entries()) {
    const line = index + 2;
    const fail = (message) => { result.failed += 1; if (result.errors.length < 200) result.errors.push({ row: line, message }); };
    const target = await findRecord(client, context.organizationId, column(record, "record"));
    if (!target) { fail("No lead, deal, contact or company matches the Record column."); continue; }
    const when = readDate(column(record, "date"));
    if (!when) { fail("The date cannot be read (use 2025-11-04 or 04/11/2025, with an optional time)."); continue; }
    const type = TYPES[headerKey(column(record, "type") || "other")] ?? "other";
    const subject = (column(record, "subject") || `${type === "note" ? "Note" : type.charAt(0).toUpperCase() + type.slice(1)} (imported)`).slice(0, 300);
    const details = column(record, "details").slice(0, 20000) || null;
    const byEmail = column(record, "by").toLowerCase();
    const by = members.get(byEmail) ?? context.userId ?? null;
    const key = `history:${fileKey}:${line}:${target.id}`.slice(0, 300);
    await client.query("SAVEPOINT history_import_row");
    try {
      const instant = (await client.query("SELECT (($1::date + $2::time) AT TIME ZONE COALESCE(timezone, 'Asia/Kolkata')) AS at FROM public.organizations WHERE id = $3",
        [when.day, when.time, context.organizationId])).rows[0].at;
      if (type === "note") {
        const kept = (await client.query("SELECT 1 FROM tenant.crm_notes WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND title = $4 AND created_at = $5",
          [context.organizationId, target.type, target.id, subject, instant])).rows[0];
        if (kept) { result.skipped += 1; await client.query("RELEASE SAVEPOINT history_import_row"); continue; }
        const text = details ?? subject;
        await client.query(
          `INSERT INTO tenant.crm_notes (organization_id, entity_type, entity_id, title, body, body_format, body_text, is_pinned, visibility, version, created_by, updated_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'html', $6, false, 'shared', 1, $7, $7, $8, $8)`,
          [context.organizationId, target.type, target.id, subject, `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>`, text, by, instant]);
        result.notes += 1;
      } else {
        const kept = (await client.query("SELECT 1 FROM tenant.crm_activities WHERE organization_id = $1 AND external_id = $2", [context.organizationId, key])).rows[0];
        if (kept) { result.skipped += 1; await client.query("RELEASE SAVEPOINT history_import_row"); continue; }
        await client.query(
          `INSERT INTO tenant.crm_activities (organization_id, entity_type, entity_id, activity_type, subject, description, status, outcome, assigned_to, start_at, completed_at,
                                              external_id, created_by, updated_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, $8, $9, $9, $10, $8, $8, $9)`,
          [context.organizationId, target.type, target.id, type, subject, details, column(record, "outcome").slice(0, 1000) || null, by, instant, key]);
        result.created += 1;
      }
      await client.query("RELEASE SAVEPOINT history_import_row");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT history_import_row");
      if (error?.code && /^[0-9A-Z]{5}$/.test(error.code) && !String(error.code).startsWith("22") && !String(error.code).startsWith("23")) throw error;
      fail(error?.message?.slice(0, 200) ?? "This row could not be imported.");
    }
  }
  return result;
}

