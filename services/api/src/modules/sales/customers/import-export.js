// Customer import (CSV / XLSX) and export (CSV).
//
// Import is two steps, both stateless: analyze the file (headers, a suggested
// column mapping, sample rows), then run it with the confirmed mapping. Every
// row goes through createCustomer or updateCustomer, so validation, duplicate
// detection, numbering and history behave exactly as for a customer typed in
// by hand. A row that fails is reported with its reason and never stops the
// rest of the file. `dryRun` validates the whole file and saves nothing.
//
// A row that matches an existing customer is handled by `duplicateMode`:
//   skip   — the row is left out;
//   update — the existing customer is updated from the row;
//   review — the row is left out and listed for a person to decide.
import { parseCsvUpload } from "../../../core/platform/data-exchange/csv.js";
import { isXlsxFileName, parseXlsxUpload } from "../../../core/platform/data-exchange/xlsx.js";
import { requireCustomerPermission } from "./access.js";
import { CUSTOMER_KINDS, CUSTOMER_PERMISSIONS, CustomerError, GST_REGISTRATION_TYPES, gstStateCode } from "./constants.js";
import { findDuplicateCustomers } from "./duplicates.js";
import { buildCustomerListWhere, createCustomer, customerSelect, toCustomer, updateCustomer } from "./records.js";
import { text } from "./validation.js";

const IMPORT_ROW_LIMIT = 2000;
const EXPORT_ROW_LIMIT = 10000;
const DUPLICATE_MODES = ["skip", "update", "review"];

// Importable fields, in template order. `aliases` are other header spellings
// the column mapping recognizes automatically.
export const CUSTOMER_IMPORT_FIELDS = Object.freeze([
  { key: "displayName", label: "Customer Name", aliases: ["name", "customer", "company", "company name"], sample: "Mehta Fabrics" },
  { key: "legalName", label: "Legal Name", aliases: ["registered name", "legal company name"], sample: "Mehta Fabrics Private Limited" },
  { key: "customerKind", label: "Customer Type", aliases: ["type", "kind"], sample: "Business" },
  { key: "email", label: "Email", aliases: ["email address", "e-mail"], sample: "accounts@mehtafabrics.example" },
  { key: "phone", label: "Phone", aliases: ["telephone", "phone number", "mobile"], sample: "+91 22 4000 5678" },
  { key: "website", label: "Website", aliases: ["url", "web"], sample: "mehtafabrics.example" },
  { key: "countryCode", label: "Country Code", aliases: ["country"], sample: "IN" },
  { key: "currencyCode", label: "Currency", aliases: ["currency code"], sample: "INR" },
  { key: "gstRegistrationType", label: "GST Registration Type", aliases: ["gst type", "registration type", "gst treatment"], sample: "Registered – Regular" },
  { key: "gstin", label: "GSTIN", aliases: ["gst number", "gst no", "gst"], sample: "27AAACM1234A1Z5" },
  { key: "placeOfSupply", label: "Place of Supply", aliases: ["pos"], sample: "Maharashtra" },
  { key: "paymentTerms", label: "Payment Terms", aliases: ["terms", "payment term"], sample: "" },
  { key: "priceList", label: "Price List", aliases: ["pricelist"], sample: "" },
  { key: "salespersonEmail", label: "Salesperson Email", aliases: ["salesperson", "owner", "owner email", "account manager"], sample: "" },
  { key: "line1", label: "Address Line 1", aliases: ["address", "street", "billing address", "address 1"], sample: "12 Kalbadevi Road" },
  { key: "line2", label: "Address Line 2", aliases: ["address 2"], sample: "" },
  { key: "city", label: "City", aliases: ["town"], sample: "Mumbai" },
  { key: "district", label: "District", aliases: [], sample: "" },
  { key: "state", label: "State", aliases: ["province", "region"], sample: "Maharashtra" },
  { key: "postalCode", label: "Postal Code", aliases: ["pin", "pincode", "pin code", "zip", "zip code"], sample: "400002" },
  { key: "contactFirstName", label: "Contact First Name", aliases: ["contact", "contact name", "first name"], sample: "Anil" },
  { key: "contactLastName", label: "Contact Last Name", aliases: ["last name"], sample: "Mehta" },
  { key: "contactEmail", label: "Contact Email", aliases: [], sample: "anil@mehtafabrics.example" },
  { key: "contactPhone", label: "Contact Phone", aliases: ["contact mobile"], sample: "+91 98200 12345" },
  { key: "notes", label: "Notes", aliases: ["remarks", "comments"], sample: "" },
]);

const FIELD_BY_KEY = new Map(CUSTOMER_IMPORT_FIELDS.map((field) => [field.key, field]));
export const headerKey = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const byLabel = (list) => new Map(list.flatMap((entry) => [[headerKey(entry.label), entry.code], [headerKey(entry.code), entry.code]]));
const KIND_BY_LABEL = byLabel(CUSTOMER_KINDS);
const REGISTRATION_BY_LABEL = new Map([...byLabel(GST_REGISTRATION_TYPES), ["registered", "registered_regular"], ["regular", "registered_regular"], ["composition", "registered_composition"]]);

// A value starting with a formula character would run in a spreadsheet.
function csvCell(value) {
  let cell = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`;
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}
export const toCsv = (rows) => `﻿${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;

export function buildCustomerImportTemplate() {
  return toCsv([CUSTOMER_IMPORT_FIELDS.map((field) => field.label), CUSTOMER_IMPORT_FIELDS.map((field) => field.sample)]);
}

export function parseUpload(bytes, fileName) {
  return isXlsxFileName(fileName) ? parseXlsxUpload(bytes, { maxRows: IMPORT_ROW_LIMIT }) : parseCsvUpload(bytes, { maxRows: IMPORT_ROW_LIMIT });
}

function suggestMapping(headers) {
  const mapping = {};
  const taken = new Set();
  for (const header of headers) {
    const key = headerKey(header);
    const field = CUSTOMER_IMPORT_FIELDS.find((entry) => !taken.has(entry.key) && (headerKey(entry.label) === key || headerKey(entry.key) === key || entry.aliases.includes(key)));
    if (field) { mapping[header] = field.key; taken.add(field.key); }
  }
  return mapping;
}

// Step 1: read the file and propose a column mapping.
export async function analyzeCustomerImport(_client, context, { bytes, fileName }) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.import, "You do not have permission to import customers.");
  const parsed = parseUpload(bytes, fileName);
  return {
    fileName,
    headers: parsed.headers,
    rowCount: parsed.rowCount ?? parsed.records.length,
    sampleRows: parsed.records.slice(0, 5),
    suggestedMapping: suggestMapping(parsed.headers),
    fields: CUSTOMER_IMPORT_FIELDS.map(({ key, label }) => ({ key, label })),
  };
}

function rowValues(record, mapping) {
  const values = {};
  for (const [header, fieldKey] of Object.entries(mapping)) {
    if (!FIELD_BY_KEY.has(fieldKey)) continue;
    const value = text(record[header]);
    if (value) values[fieldKey] = value;
  }
  return values;
}

// Turns a row into createCustomer input, resolving names to records.
async function rowToInput(client, context, values, lookups) {
  const input = {};
  for (const field of ["displayName", "legalName", "email", "phone", "website", "gstin", "notes"]) if (values[field]) input[field] = values[field];
  if (values.customerKind) input.customerKind = KIND_BY_LABEL.get(headerKey(values.customerKind)) ?? values.customerKind;
  if (values.countryCode) input.countryCode = lookups.country(values.countryCode);
  if (values.currencyCode) input.currencyCode = values.currencyCode.toUpperCase();
  if (values.gstRegistrationType) input.gstRegistrationType = REGISTRATION_BY_LABEL.get(headerKey(values.gstRegistrationType)) ?? values.gstRegistrationType;
  if (values.placeOfSupply) input.placeOfSupply = /^\d{2}$/.test(values.placeOfSupply) ? values.placeOfSupply : gstStateCode(values.placeOfSupply) ?? values.placeOfSupply;
  if (values.paymentTerms) input.paymentTermId = await lookups.paymentTerm(values.paymentTerms);
  if (values.priceList) input.priceListId = await lookups.priceList(values.priceList);
  if (values.salespersonEmail) input.ownerUserId = await lookups.user(values.salespersonEmail);
  return input;
}

function makeLookups(client, context) {
  const cache = new Map();
  const find = async (kind, sql, value, message) => {
    const key = `${kind}:${value.toLowerCase()}`;
    if (!cache.has(key)) cache.set(key, (await client.query(sql, [context.organizationId, value.toLowerCase()])).rows[0]?.id ?? null);
    if (!cache.get(key)) throw new CustomerError(400, message, "SALES_CUSTOMER_IMPORT_ROW");
    return cache.get(key);
  };
  return {
    country: (value) => (value.length === 2 ? value.toUpperCase() : ({ india: "IN", "united states": "US", usa: "US", "united kingdom": "GB", uk: "GB", "united arab emirates": "AE", uae: "AE", singapore: "SG" }[value.toLowerCase()] ?? value.toUpperCase())),
    paymentTerm: (value) => find("term", `SELECT id FROM tenant.payment_terms WHERE organization_id = $1 AND status = 'active' AND (lower(name) = $2 OR lower(code) = $2)`, value, `Payment terms "${value}" were not found.`),
    priceList: (value) => find("list", `SELECT id FROM tenant.price_lists WHERE organization_id = $1 AND status = 'active' AND price_list_type = 'sales' AND (lower(name) = $2 OR lower(code) = $2)`, value, `Price list "${value}" was not found.`),
    user: (value) => find("user",
      `SELECT users.id FROM public.organization_memberships membership JOIN public.users users ON users.id = membership.user_id
        WHERE membership.organization_id = $1 AND membership.status = 'active' AND lower(users.email) = $2`, value, `No active user has the email ${value}.`),
  };
}

const describeMatch = (match) => `${match.name ?? "a customer"}${match.customerNumber ? ` (${match.customerNumber})` : ""}: ${match.reasons.map((reason) => reason.label).join(", ")}`;

// Step 2: validate (dryRun) or import the file.
// options: mapping { header: fieldKey }, duplicateMode (skip | update |
//          review), dryRun, defaults { countryCode, currencyCode }.
export async function importCustomers(client, context, { bytes, fileName, mapping = {}, duplicateMode = "skip", dryRun = false, defaults = {} }) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.import, "You do not have permission to import customers.");
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.create, "You do not have permission to create customers.");
  if (!DUPLICATE_MODES.includes(duplicateMode)) throw new CustomerError(400, "Choose how duplicates are handled.", "SALES_CUSTOMER_IMPORT_MAPPING");
  if (duplicateMode === "update") requireCustomerPermission(context, CUSTOMER_PERMISSIONS.edit, "You do not have permission to update customers.");
  const parsed = parseUpload(bytes, fileName);
  const unknown = Object.keys(mapping).filter((header) => !parsed.headers.includes(header));
  if (unknown.length) throw new CustomerError(400, `The file has no column named "${unknown[0]}".`, "SALES_CUSTOMER_IMPORT_MAPPING");
  if (!Object.values(mapping).includes("displayName")) throw new CustomerError(400, "Map the Customer Name column.", "SALES_CUSTOMER_IMPORT_MAPPING");

  const lookups = makeLookups(client, context);
  const results = [];
  await client.query("SAVEPOINT customer_import");
  for (const [index, record] of parsed.records.entries()) {
    const rowNumber = index + 2;
    const values = rowValues(record, mapping);
    const name = values.displayName ?? null;
    await client.query("SAVEPOINT customer_import_row");
    try {
      const input = { countryCode: text(defaults.countryCode) || undefined, currencyCode: text(defaults.currencyCode) || undefined, ...(await rowToInput(client, context, values, lookups)) };
      const duplicates = await findDuplicateCustomers(client, context,
        { displayName: input.displayName, legalName: input.legalName, website: input.website, email: input.email, phone: input.phone, gstin: input.gstin, city: values.city });
      const strong = duplicates.matches.find((match) => match.strength === "strong");
      if (strong) {
        if (duplicateMode === "update" && strong.isCustomer) {
          const { customerKind: _kind, ...changes } = input;
          const updated = await updateCustomer(client, context, strong.id, { ...changes, allowDuplicate: false });
          results.push({ rowNumber, name, outcome: "updated", customerId: updated.id, customerNumber: updated.customerNumber, message: `Updated ${updated.customerNumber}.` });
        } else {
          results.push({ rowNumber, name, outcome: duplicateMode === "review" ? "review" : "skipped", customerId: strong.id, message: `Matches ${describeMatch(strong)}.` });
        }
      } else {
        if (values.line1) input.billingAddress = { line1: values.line1, line2: values.line2, city: values.city, district: values.district, state: values.state, postalCode: values.postalCode, countryCode: input.countryCode };
        if (values.contactFirstName) input.primaryContact = { firstName: values.contactFirstName, lastName: values.contactLastName, email: values.contactEmail, phone: values.contactPhone };
        const created = await createCustomer(client, context, { ...input, origin: "import" });
        const possible = duplicates.matches[0];
        results.push({ rowNumber, name, outcome: "created", customerId: created.id, customerNumber: created.customerNumber,
          message: possible ? `Created. Possible duplicate of ${describeMatch(possible)}.` : "Created." });
      }
      await client.query("RELEASE SAVEPOINT customer_import_row");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT customer_import_row");
      if (!error?.status || error.status >= 500) throw error;
      results.push({ rowNumber, name, outcome: "failed", message: error.message, field: error.details?.issues?.[0]?.field ?? null });
    }
  }
  if (dryRun) await client.query("ROLLBACK TO SAVEPOINT customer_import");
  await client.query("RELEASE SAVEPOINT customer_import");

  const count = (outcome) => results.filter((result) => result.outcome === outcome).length;
  return {
    dryRun: Boolean(dryRun),
    total: results.length,
    created: count("created"),
    updated: count("updated"),
    skipped: count("skipped"),
    review: count("review"),
    failed: count("failed"),
    // In a dry run nothing was saved, so the ids and numbers are not real.
    results: dryRun ? results.map(({ customerNumber: _number, ...result }) => ({ ...result, customerId: result.outcome === "created" ? null : result.customerId ?? null })) : results,
  };
}

// The rows that did not import, as a CSV to correct and upload again.
export function buildCustomerImportErrorFile(results) {
  return toCsv([["Row", "Customer Name", "Result", "Reason"],
    ...results.filter((result) => ["failed", "skipped", "review"].includes(result.outcome)).map((result) => [result.rowNumber, result.name ?? "", result.outcome, result.message])]);
}

// The list as CSV, with the same filters as the screen. Receivable columns
// are included only for callers who may see them.
export async function exportCustomers(client, context, filters = {}) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.export, "You do not have permission to export customers.");
  const { finance, values, sql } = buildCustomerListWhere(context, filters);
  const { rows } = await client.query(`${customerSelect({ finance })} ${sql} ORDER BY lower(customer.display_name) LIMIT ${EXPORT_ROW_LIMIT + 1}`, values);
  if (rows.length > EXPORT_ROW_LIMIT) throw new CustomerError(413, `More than ${EXPORT_ROW_LIMIT} customers match. Narrow the filters and export again.`, "SALES_CUSTOMER_EXPORT_TOO_LARGE");
  const header = ["Customer Number", "Customer Name", "Legal Name", "Customer Type", "Status", "Block Reason", "Email", "Phone", "Website", "Primary Contact", "Contact Phone",
    "City", "State", "Country", "Currency", "Price List", "Payment Terms", "GST Registration Type", "GSTIN", "Place of Supply", "Salesperson", "Created",
    ...(finance ? ["Outstanding", "Overdue"] : [])];
  const body = rows.map((row) => {
    const customer = toCustomer(row, { finance });
    return [customer.customerNumber, customer.displayName, customer.legalName, customer.customerKindLabel, customer.statusLabel, customer.blockReason, customer.email, customer.phone,
      customer.website, customer.primaryContactName, customer.primaryContactPhone, customer.city, customer.state, customer.countryCode, customer.currencyCode, customer.priceListName,
      customer.paymentTermName, customer.gstRegistrationLabel, customer.gstin, customer.placeOfSupplyName, customer.ownerName,
      customer.createdAt ? new Date(customer.createdAt).toISOString().slice(0, 10) : "",
      ...(finance ? [customer.outstanding, customer.overdue] : [])];
  });
  return { fileName: `customers-${new Date().toISOString().slice(0, 10)}.csv`, csv: toCsv([header, ...body]), count: rows.length };
}
