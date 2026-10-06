// Bringing existing suppliers in from a CSV or Excel file, and the list out.
//
// Every row goes through createSupplier, so it gets the same validation and
// duplicate rules as a supplier entered by hand: a GSTIN already on a
// supplier, or a strong match, is reported against that row and nothing is
// created for it. One bad row never fails the file: each row says what
// happened ("Row 14: GSTIN already belongs to SUP-000045").
import { parseCsvUpload } from "../../../core/platform/data-exchange/csv.js";
import { isXlsxFileName, parseXlsxUpload } from "../../../core/platform/data-exchange/xlsx.js";
import { gstStateCode } from "../../../core/tax/index.js";
import { GST_REGISTRATION_TYPES, SUPPLIER_CATEGORIES, SUPPLIER_PERMISSIONS, SUPPLIER_TYPES, SupplierError, text } from "./constants.js";
import { requireSupplierPermission } from "./access.js";
import { createSupplier, listSuppliers } from "./records.js";

const IMPORT_ROW_LIMIT = 2000;
const EXPORT_ROW_LIMIT = 10000;

export const SUPPLIER_IMPORT_FIELDS = Object.freeze([
  { key: "supplierName", label: "Supplier Name", aliases: ["name", "supplier", "vendor", "vendor name", "company", "company name"], sample: "Shree Steel Traders" },
  { key: "legalName", label: "Legal Name", aliases: ["registered name", "legal company name"], sample: "Shree Steel Traders Private Limited" },
  { key: "supplierType", label: "Supplier Type", aliases: ["type"], sample: "Business" },
  { key: "category", label: "Category", aliases: ["supplier category"], sample: "Raw Materials" },
  { key: "primaryEmail", label: "Email", aliases: ["email address", "e-mail"], sample: "sales@shreesteel.example" },
  { key: "primaryPhone", label: "Phone", aliases: ["telephone", "phone number", "mobile"], sample: "+91 20 4000 1234" },
  { key: "website", label: "Website", aliases: ["url", "web"], sample: "shreesteel.example" },
  { key: "countryCode", label: "Country Code", aliases: ["country"], sample: "IN" },
  { key: "defaultCurrency", label: "Currency", aliases: ["currency code", "default currency"], sample: "INR" },
  { key: "paymentTerms", label: "Payment Terms", aliases: ["terms", "payment term"], sample: "" },
  { key: "buyerEmail", label: "Buyer Email", aliases: ["buyer", "owner", "owner email", "purchaser"], sample: "" },
  { key: "gstRegistrationType", label: "GST Registration Type", aliases: ["gst type", "registration type"], sample: "Registered – Regular" },
  { key: "gstin", label: "GSTIN", aliases: ["gst number", "gst no", "gst"], sample: "27AAACS1234A1Z5" },
  { key: "pan", label: "PAN", aliases: ["pan number", "tax id"], sample: "" },
  { key: "line1", label: "Address Line 1", aliases: ["address", "street", "address 1"], sample: "Plot 14, MIDC Bhosari" },
  { key: "line2", label: "Address Line 2", aliases: ["address 2"], sample: "" },
  { key: "city", label: "City", aliases: ["town"], sample: "Pune" },
  { key: "state", label: "State", aliases: ["province", "region"], sample: "Maharashtra" },
  { key: "postalCode", label: "Postal Code", aliases: ["pin", "pincode", "pin code", "zip", "zip code"], sample: "411026" },
  { key: "contactFirstName", label: "Contact First Name", aliases: ["contact", "contact name", "first name"], sample: "Priya" },
  { key: "contactLastName", label: "Contact Last Name", aliases: ["last name"], sample: "Sharma" },
  { key: "contactEmail", label: "Contact Email", aliases: [], sample: "priya@shreesteel.example" },
  { key: "contactPhone", label: "Contact Phone", aliases: ["contact mobile"], sample: "+91 98220 12345" },
  { key: "notes", label: "Notes", aliases: ["remarks", "comments"], sample: "" },
]);

const FIELD_BY_KEY = new Map(SUPPLIER_IMPORT_FIELDS.map((field) => [field.key, field]));
const headerKey = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const byLabel = (list) => new Map(list.flatMap((entry) => [[headerKey(entry.label), entry.code], [headerKey(entry.code), entry.code]]));
const TYPE_BY_LABEL = byLabel(SUPPLIER_TYPES);
const CATEGORY_BY_LABEL = byLabel(SUPPLIER_CATEGORIES);
const REGISTRATION_BY_LABEL = new Map([...byLabel(GST_REGISTRATION_TYPES), ["registered", "registered_regular"], ["regular", "registered_regular"], ["composition", "registered_composition"]]);
const COUNTRY_BY_NAME = Object.freeze({ india: "IN", "united states": "US", usa: "US", "united kingdom": "GB", uk: "GB", germany: "DE", china: "CN", japan: "JP",
  "united arab emirates": "AE", uae: "AE", singapore: "SG" });

// A value starting with a formula character would run in a spreadsheet.
function csvCell(value) {
  let cell = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
const toCsv = (rows) => `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;

export function buildSupplierImportTemplate() {
  return toCsv([SUPPLIER_IMPORT_FIELDS.map((field) => field.label), SUPPLIER_IMPORT_FIELDS.map((field) => field.sample)]);
}

const parseUpload = (bytes, fileName) =>
  (isXlsxFileName(fileName) ? parseXlsxUpload(bytes, { maxRows: IMPORT_ROW_LIMIT }) : parseCsvUpload(bytes, { maxRows: IMPORT_ROW_LIMIT }));

function suggestMapping(headers) {
  const mapping = {};
  const taken = new Set();
  for (const header of headers) {
    const key = headerKey(header);
    const field = SUPPLIER_IMPORT_FIELDS.find((entry) => !taken.has(entry.key) && (headerKey(entry.label) === key || headerKey(entry.key) === key || entry.aliases.includes(key)));
    if (field) { mapping[header] = field.key; taken.add(field.key); }
  }
  return mapping;
}

// Step 1: read the file and propose a column mapping.
export async function analyzeSupplierImport(_client, context, { bytes, fileName }) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.import, "You do not have permission to import suppliers.");
  const parsed = parseUpload(bytes, fileName);
  return {
    fileName, headers: parsed.headers, rowCount: parsed.rowCount ?? parsed.records.length, sampleRows: parsed.records.slice(0, 5),
    suggestedMapping: suggestMapping(parsed.headers), fields: SUPPLIER_IMPORT_FIELDS.map(({ key, label }) => ({ key, label })),
  };
}

function rowValues(record, mapping) {
  const values = {};
  for (const [header, fieldKey] of Object.entries(mapping)) {
    if (!FIELD_BY_KEY.has(fieldKey)) continue;
    // A leading ' is the spreadsheet guard our exports and template add before =, +, - or @: not part of the value.
    const value = text(String(record[header] ?? "").replace(/^'(?=[=+\-@])/, ""));
    if (value) values[fieldKey] = value;
  }
  return values;
}

function rowError(message, field = null) {
  return new SupplierError(400, message, "SUPPLIER_IMPORT_ROW", field ? { issues: [{ field, message }] } : undefined);
}

function makeLookups(client, context) {
  const cache = new Map();
  const find = async (kind, sql, value, message, field) => {
    const key = `${kind}:${value.toLowerCase()}`;
    if (!cache.has(key)) cache.set(key, (await client.query(sql, [context.organizationId, value.toLowerCase()])).rows[0]?.id ?? null);
    if (!cache.get(key)) throw rowError(message, field);
    return cache.get(key);
  };
  return {
    paymentTerm: (value) => find("term", `SELECT id FROM tenant.payment_terms WHERE organization_id = $1 AND status = 'active' AND is_purchase_enabled AND (lower(name) = $2 OR lower(code) = $2)`,
      value, `Payment terms "${value}" were not found among the active purchase payment terms.`, "paymentTermId"),
    buyer: (value) => find("user", `SELECT users.id FROM public.organization_memberships membership JOIN public.users users ON users.id = membership.user_id
        WHERE membership.organization_id = $1 AND membership.status = 'active' AND users.status = 'active' AND lower(users.email) = $2`,
      value, `No active user has the email ${value}.`, "assignedBuyerId"),
  };
}

// Turns a row into createSupplier input, resolving names to records. Unknown labels are passed on and refused by validation with the field named.
async function rowToInput(values, lookups, defaults) {
  const input = { origin: "import" };
  for (const field of ["supplierName", "legalName", "primaryEmail", "primaryPhone", "website", "gstin", "pan", "notes"]) if (values[field]) input[field] = values[field];
  input.supplierType = values.supplierType ? TYPE_BY_LABEL.get(headerKey(values.supplierType)) ?? values.supplierType : "business";
  input.category = values.category ? CATEGORY_BY_LABEL.get(headerKey(values.category)) ?? values.category : text(defaults.category) ?? undefined;
  const country = values.countryCode ?? text(defaults.countryCode);
  if (country) input.countryCode = country.length === 2 ? country.toUpperCase() : COUNTRY_BY_NAME[country.toLowerCase()] ?? country;
  const currency = values.defaultCurrency ?? text(defaults.currency);
  if (currency) input.defaultCurrency = currency.toUpperCase();
  if (values.gstRegistrationType) input.gstRegistrationType = REGISTRATION_BY_LABEL.get(headerKey(values.gstRegistrationType)) ?? values.gstRegistrationType;
  if (values.paymentTerms) input.paymentTermId = await lookups.paymentTerm(values.paymentTerms);
  else if (defaults.paymentTermId) input.paymentTermId = defaults.paymentTermId;
  if (values.buyerEmail) input.assignedBuyerId = await lookups.buyer(values.buyerEmail);
  if (values.line1 || values.city) {
    const stateCode = values.state ? (/^\d{2}$/.test(values.state) ? values.state : gstStateCode(values.state) ?? null) : null;
    input.address = { addressType: "registered", line1: values.line1, line2: values.line2, city: values.city, state: values.state, stateCode, postalCode: values.postalCode,
      countryCode: input.countryCode, gstin: input.gstin };
  }
  if (values.contactFirstName)
    input.primaryContact = { firstName: values.contactFirstName, lastName: values.contactLastName, email: values.contactEmail, mobile: values.contactPhone, role: "procurement" };
  return input;
}

// Step 2: validate (dryRun) or import the file.
// options: mapping { header: fieldKey }, dryRun, defaults { countryCode, currency, paymentTermId, category }: used where a row leaves them out.
export async function importSuppliers(client, context, { bytes, fileName, mapping = {}, dryRun = false, defaults = {} }) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.import, "You do not have permission to import suppliers.");
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.create, "You do not have permission to create suppliers.");
  const parsed = parseUpload(bytes, fileName);
  const unknown = Object.keys(mapping).filter((header) => !parsed.headers.includes(header));
  if (unknown.length) throw new SupplierError(400, `The file has no column named "${unknown[0]}".`, "SUPPLIER_IMPORT_MAPPING");
  if (!Object.values(mapping).includes("supplierName")) throw new SupplierError(400, "Map the Supplier Name column.", "SUPPLIER_IMPORT_MAPPING");

  const lookups = makeLookups(client, context);
  const results = [];
  await client.query("SAVEPOINT supplier_import");
  for (const [index, record] of parsed.records.entries()) {
    const rowNumber = index + 2;
    const values = rowValues(record, mapping);
    const name = values.supplierName ?? null;
    await client.query("SAVEPOINT supplier_import_row");
    try {
      if (!name) throw rowError("Missing Supplier Name.", "supplierName");
      const input = await rowToInput(values, lookups, defaults);
      const created = await createSupplier(client, context, input);
      results.push({ rowNumber, name, outcome: "created", supplierId: created.supplier.id, supplierNumber: created.supplier.supplierNumber, message: `Created ${created.supplier.supplierNumber}.` });
      await client.query("RELEASE SAVEPOINT supplier_import_row");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT supplier_import_row");
      if (!error?.status || error.status >= 500) throw error;
      const match = error.details?.matches?.[0];
      const duplicate = ["SUPPLIER_DUPLICATE", "SUPPLIER_GSTIN_TAKEN", "SUPPLIER_ORGANIZATION_EXISTS"].includes(error.code);
      results.push({
        rowNumber, name, outcome: duplicate ? "duplicate" : "failed",
        message: error.code === "SUPPLIER_DUPLICATE" && match ? `Matches ${match.number ?? ""} ${match.name}: ${match.reasons.map((reason) => reason.label).join(", ")}.`.replace(/\s+/g, " ") : error.message,
        field: error.details?.issues?.[0]?.field ?? null, matchingSupplierId: match?.supplierId ?? null,
      });
    }
  }
  if (dryRun) await client.query("ROLLBACK TO SAVEPOINT supplier_import");
  await client.query("RELEASE SAVEPOINT supplier_import");
  const count = (outcome) => results.filter((result) => result.outcome === outcome).length;
  return {
    dryRun: Boolean(dryRun), total: results.length, created: count("created"), duplicates: count("duplicate"), failed: count("failed"),
    // In a dry run nothing was saved, so numbers are not real.
    results: dryRun ? results.map(({ supplierNumber: _number, supplierId: _id, ...result }) => ({ ...result, message: result.outcome === "created" ? "Ready to import." : result.message })) : results,
  };
}

// The rows that did not import, as a CSV to correct and upload again.
export function buildSupplierImportErrorFile(results) {
  return toCsv([["Row", "Supplier Name", "Result", "Reason"],
    ...results.filter((result) => result.outcome !== "created").map((result) => [result.rowNumber, result.name ?? "", result.outcome, result.message])]);
}

// The list as CSV, with the same view and filters as the screen.
export async function exportSuppliers(client, context, filters = {}) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.export, "You do not have permission to export suppliers.");
  const { rows, total } = await listSuppliers(client, context, { ...filters, limit: EXPORT_ROW_LIMIT, offset: 0 });
  if (total > EXPORT_ROW_LIMIT) throw new SupplierError(413, `More than ${EXPORT_ROW_LIMIT} suppliers match. Narrow the filters and export again.`, "SUPPLIER_EXPORT_TOO_LARGE");
  const header = ["Supplier Number", "Supplier Name", "Legal Name", "Supplier Type", "Category", "Status", "Block Reason", "Email", "Phone", "Website", "Primary Contact",
    "Contact Email", "City", "State", "Country", "Currency", "Payment Terms", "Buyer", "GST Registration Type", "GSTIN", "PAN", "Also a Customer", "Created"];
  const body = rows.map((supplier) => [supplier.supplierNumber, supplier.supplierName, supplier.legalName, supplier.supplierTypeLabel, supplier.categoryLabel, supplier.statusLabel,
    supplier.blockedReason, supplier.primaryEmail, supplier.primaryPhone, supplier.website, supplier.primaryContact?.name, supplier.primaryContact?.email, supplier.primaryAddress?.city,
    supplier.primaryAddress?.state ?? supplier.registeredStateName, supplier.countryCode, supplier.defaultCurrency, supplier.paymentTermName, supplier.assignedBuyerName,
    supplier.gstRegistrationLabel, supplier.gstin, supplier.pan, supplier.isCustomer ? supplier.customerNumber : "", supplier.createdAt ? new Date(supplier.createdAt).toISOString().slice(0, 10) : ""]);
  return { fileName: `suppliers-${new Date().toISOString().slice(0, 10)}.csv`, csv: toCsv([header, ...body]), count: rows.length };
}
