// Import and export of customer addresses and customer contacts, so several
// hundred customer locations and people do not have to be typed in.
//
// Each has its own template. Every row names its customer by customer number
// and goes through the same operation the screen uses (addCustomerAddress,
// linkCustomerContact, addCustomerContact), so validation, defaults, history
// and permissions behave exactly as they do by hand. A contact row is matched
// to an existing contact by email or mobile and linked, never duplicated.
// `dryRun` checks the whole file and saves nothing.
import { customerScopeSql, requireCustomerPermission } from "./access.js";
import { addCustomerAddress } from "./addresses.js";
import { CUSTOMER_ADDRESS_TYPES, CUSTOMER_CONTACT_ROLES, CUSTOMER_PARTY_SQL, CUSTOMER_PERMISSIONS, CustomerError } from "./constants.js";
import { addCustomerContact, findExistingContact, linkCustomerContact, updateCustomerContact } from "./contacts.js";
import { headerKey, parseUpload, toCsv } from "./import-export.js";
import { buildCustomerListWhere } from "./records.js";
import { text } from "./validation.js";

const EXPORT_ROW_LIMIT = 20000;

const FIELDS = Object.freeze({
  addresses: [
    { key: "customerNumber", label: "Customer Number", aliases: ["customer no", "customer", "customer id", "customer code"], sample: "CUS-000001" },
    { key: "label", label: "Address Label", aliases: ["label", "location", "location name", "site"], sample: "Nagpur Plant" },
    { key: "addressType", label: "Address Type", aliases: ["type"], sample: "Shipping" },
    { key: "line1", label: "Address Line 1", aliases: ["address", "street", "address 1"], sample: "Plot 24, MIDC Hingna" },
    { key: "line2", label: "Address Line 2", aliases: ["address 2"], sample: "" },
    { key: "city", label: "City", aliases: ["town"], sample: "Nagpur" },
    { key: "district", label: "District", aliases: [], sample: "Nagpur" },
    { key: "state", label: "State", aliases: ["province", "region"], sample: "Maharashtra" },
    { key: "postalCode", label: "Postal Code", aliases: ["pin", "pincode", "pin code", "zip", "zip code"], sample: "440016" },
    { key: "countryCode", label: "Country Code", aliases: ["country"], sample: "IN" },
    { key: "gstin", label: "GSTIN", aliases: ["gst number", "gst no", "location gstin"], sample: "" },
    { key: "contactPerson", label: "Contact Person", aliases: ["contact", "contact name"], sample: "Amit Verma" },
    { key: "phone", label: "Phone", aliases: ["telephone", "mobile"], sample: "+91 712 400 1000" },
    { key: "email", label: "Email", aliases: ["email address"], sample: "" },
    { key: "isDefaultBilling", label: "Default Billing", aliases: ["default billing address", "billing default"], sample: "No" },
    { key: "isDefaultShipping", label: "Default Shipping", aliases: ["default shipping address", "shipping default"], sample: "Yes" },
  ],
  contacts: [
    { key: "customerNumber", label: "Customer Number", aliases: ["customer no", "customer", "customer id", "customer code"], sample: "CUS-000001" },
    { key: "firstName", label: "First Name", aliases: ["name", "contact name", "first"], sample: "Amit" },
    { key: "lastName", label: "Last Name", aliases: ["surname", "last"], sample: "Verma" },
    { key: "email", label: "Email", aliases: ["email address", "e-mail"], sample: "amit@example.com" },
    { key: "phone", label: "Mobile", aliases: ["phone", "mobile number", "phone number"], sample: "+91 98200 55555" },
    { key: "jobTitle", label: "Job Title", aliases: ["designation", "title"], sample: "Warehouse Manager" },
    { key: "department", label: "Department", aliases: ["dept"], sample: "Logistics" },
    { key: "role", label: "Role", aliases: ["contact role"], sample: "Shipping / Warehouse" },
    { key: "addressLabel", label: "Address Label", aliases: ["location", "site", "address"], sample: "Nagpur Plant" },
    { key: "isPrimary", label: "Primary Contact", aliases: ["primary"], sample: "No" },
    { key: "isBillingContact", label: "Billing Contact", aliases: ["billing"], sample: "No" },
    { key: "isShippingContact", label: "Delivery Contact", aliases: ["shipping contact", "delivery", "shipping"], sample: "Yes" },
    { key: "isProcurementContact", label: "Procurement Contact", aliases: ["procurement", "purchasing contact"], sample: "No" },
    { key: "notes", label: "Notes", aliases: ["remarks", "comments"], sample: "" },
  ],
});
const REQUIRED = Object.freeze({ addresses: ["customerNumber", "line1"], contacts: ["customerNumber", "firstName"] });
const FLAGS = ["isDefaultBilling", "isDefaultShipping", "isPrimary", "isBillingContact", "isShippingContact", "isProcurementContact"];
const yes = (value) => ["yes", "y", "true", "1"].includes(text(value).toLowerCase());
const codeByLabel = (list) => new Map(list.flatMap((entry) => [[headerKey(entry.label), entry.code], [headerKey(entry.code), entry.code]]));
const ADDRESS_TYPE = new Map([...codeByLabel(CUSTOMER_ADDRESS_TYPES), ["branch", "office"], ["office", "office"], ["warehouse", "shipping"], ["plant", "shipping"], ["head office", "registered"]]);
const CONTACT_ROLE = new Map([...codeByLabel(CUSTOMER_CONTACT_ROLES), ["warehouse", "shipping"], ["shipping", "shipping"], ["delivery", "shipping"], ["purchasing", "procurement"], ["accounts", "finance"]]);

function kindOf(kind) {
  if (!FIELDS[kind]) throw new CustomerError(400, "Choose what to import: addresses or contacts.", "SALES_CUSTOMER_IMPORT_MAPPING");
  return kind;
}

export function buildCustomerRelatedImportTemplate(kind) {
  const fields = FIELDS[kindOf(kind)];
  return toCsv([fields.map((field) => field.label), fields.map((field) => field.sample)]);
}

function suggestMapping(fields, headers) {
  const mapping = {};
  const taken = new Set();
  for (const header of headers) {
    const key = headerKey(header);
    const field = fields.find((entry) => !taken.has(entry.key) && (headerKey(entry.label) === key || headerKey(entry.key) === key || entry.aliases.includes(key)));
    if (field) { mapping[header] = field.key; taken.add(field.key); }
  }
  return mapping;
}

// Step 1: read the file and propose a column mapping.
export async function analyzeCustomerRelatedImport(_client, context, kind, { bytes, fileName }) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.import, "You do not have permission to import customer data.");
  const fields = FIELDS[kindOf(kind)];
  const parsed = parseUpload(bytes, fileName);
  return {
    kind, fileName, headers: parsed.headers, rowCount: parsed.rowCount ?? parsed.records.length, sampleRows: parsed.records.slice(0, 5),
    suggestedMapping: suggestMapping(fields, parsed.headers), fields: fields.map(({ key, label }) => ({ key, label })),
  };
}

// The customer a row names, by customer number, within what the caller can see.
function customerLookup(client, context) {
  const cache = new Map();
  return async (number) => {
    const key = text(number).toUpperCase();
    if (!key) throw new CustomerError(400, "The customer number is missing.", "SALES_CUSTOMER_IMPORT_ROW");
    if (!cache.has(key)) {
      const values = [context.organizationId, key];
      const { rows } = await client.query(
        `SELECT customer.id, customer.display_name FROM tenant.business_parties customer
          WHERE customer.organization_id = $1 AND ${CUSTOMER_PARTY_SQL("customer")} AND upper(COALESCE(customer.customer_number, customer.code)) = $2${customerScopeSql(context, values, "customer")}`,
        values,
      );
      cache.set(key, rows[0] ?? null);
    }
    if (!cache.get(key)) throw new CustomerError(404, `Customer ${key} was not found.`, "SALES_CUSTOMER_IMPORT_ROW");
    return cache.get(key);
  };
}

async function importAddressRow(client, context, values, customer) {
  const input = { ...values };
  delete input.customerNumber;
  if (input.addressType) input.addressType = ADDRESS_TYPE.get(headerKey(input.addressType)) ?? input.addressType;
  else input.addressType = "shipping";
  if (input.countryCode) input.countryCode = input.countryCode.length === 2 ? input.countryCode.toUpperCase() : ({ india: "IN" }[input.countryCode.toLowerCase()] ?? input.countryCode);
  for (const flag of ["isDefaultBilling", "isDefaultShipping"]) if (flag in input) input[flag] = yes(input[flag]);
  try {
    const address = await addCustomerAddress(client, context, customer.id, input);
    return { outcome: "created", message: `Added to ${customer.display_name}${address.label ? ` as ${address.label}` : ""}.` };
  } catch (error) {
    if (error?.code === "SALES_CUSTOMER_ADDRESS_DUPLICATE") return { outcome: "skipped", message: `${customer.display_name} already has this address.` };
    throw error;
  }
}

async function importContactRow(client, context, values, customer) {
  const relationship = { jobTitle: values.jobTitle, department: values.department, notes: values.notes };
  if (values.role) relationship.role = CONTACT_ROLE.get(headerKey(values.role)) ?? values.role;
  for (const flag of ["isPrimary", "isBillingContact", "isShippingContact", "isProcurementContact"]) if (flag in values && yes(values[flag])) relationship[flag] = true;
  if (values.addressLabel) {
    const { rows } = await client.query(`SELECT id FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2 AND status = 'active' AND lower(label) = $3 LIMIT 1`,
      [context.organizationId, customer.id, values.addressLabel.toLowerCase()]);
    if (!rows[0]) throw new CustomerError(400, `${customer.display_name} has no active address labelled “${values.addressLabel}”.`, "SALES_CUSTOMER_IMPORT_ROW");
    relationship.addressId = rows[0].id;
  }
  for (const key of Object.keys(relationship)) if (relationship[key] === undefined) delete relationship[key];
  const person = { firstName: values.firstName, lastName: values.lastName, email: values.email, phone: values.phone };
  // The same email or mobile is the same person: link, never copy.
  const existing = values.email || values.phone ? (await findExistingContact(client, context, customer.id, { email: values.email, phone: values.phone })).matches[0] : null;
  if (existing?.link === "linked") {
    await updateCustomerContact(client, context, customer.id, existing.id, relationship);
    return { outcome: "updated", message: `${existing.name} is already a contact of ${customer.display_name}; the relationship was updated.` };
  }
  if (existing) {
    await linkCustomerContact(client, context, customer.id, { contactId: existing.id, ...relationship });
    return { outcome: "linked", message: `Linked the existing contact ${existing.name}${existing.accountName ? ` (${existing.accountName})` : ""}.` };
  }
  const created = await addCustomerContact(client, context, customer.id, { ...person, ...relationship, allowDuplicate: true, duplicateReason: "Imported as a new contact" });
  return { outcome: "created", message: `Added ${created.name} to ${customer.display_name}.` };
}

// Step 2: validate (dryRun) or import the file.
// input: bytes, fileName, mapping { header: fieldKey }, dryRun.
export async function importCustomerRelated(client, context, kind, { bytes, fileName, mapping = {}, dryRun = false }) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.import, "You do not have permission to import customer data.");
  const addresses = kindOf(kind) === "addresses";
  requireCustomerPermission(context, addresses ? CUSTOMER_PERMISSIONS.manageAddresses : CUSTOMER_PERMISSIONS.manageContacts,
    `You do not have permission to manage customer ${kind}.`);
  const fields = new Map(FIELDS[kind].map((field) => [field.key, field]));
  const parsed = parseUpload(bytes, fileName);
  const unknown = Object.keys(mapping).filter((header) => !parsed.headers.includes(header));
  if (unknown.length) throw new CustomerError(400, `The file has no column named "${unknown[0]}".`, "SALES_CUSTOMER_IMPORT_MAPPING");
  for (const required of REQUIRED[kind])
    if (!Object.values(mapping).includes(required)) throw new CustomerError(400, `Map the ${fields.get(required).label} column.`, "SALES_CUSTOMER_IMPORT_MAPPING");

  const findCustomer = customerLookup(client, context);
  const results = [];
  await client.query("SAVEPOINT customer_related_import");
  for (const [index, record] of parsed.records.entries()) {
    const rowNumber = index + 2;
    const values = {};
    for (const [header, fieldKey] of Object.entries(mapping)) {
      if (!fields.has(fieldKey)) continue;
      const value = text(record[header]);
      if (value || FLAGS.includes(fieldKey)) values[fieldKey] = value;
    }
    const name = addresses ? [values.customerNumber, values.label || values.city].filter(Boolean).join(" · ") : [values.customerNumber, [values.firstName, values.lastName].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
    await client.query("SAVEPOINT customer_related_import_row");
    try {
      for (const required of REQUIRED[kind]) if (!values[required]) throw new CustomerError(400, `${fields.get(required).label} is missing.`, "SALES_CUSTOMER_IMPORT_ROW");
      const customer = await findCustomer(values.customerNumber);
      const result = addresses ? await importAddressRow(client, context, values, customer) : await importContactRow(client, context, values, customer);
      results.push({ rowNumber, name, customerId: customer.id, ...result });
      await client.query("RELEASE SAVEPOINT customer_related_import_row");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT customer_related_import_row");
      if (!error?.status || error.status >= 500) throw error;
      results.push({ rowNumber, name, outcome: "failed", message: error.message });
    }
  }
  if (dryRun) await client.query("ROLLBACK TO SAVEPOINT customer_related_import");
  await client.query("RELEASE SAVEPOINT customer_related_import");
  const count = (outcome) => results.filter((result) => result.outcome === outcome).length;
  return {
    kind, dryRun: Boolean(dryRun), total: results.length, created: count("created"), linked: count("linked"), updated: count("updated"), skipped: count("skipped"),
    review: 0, failed: count("failed"), results,
  };
}

// The addresses, or the contacts, of the customers the list shows for the
// same view and filters.
export async function exportCustomerRelated(client, context, kind, filters = {}) {
  requireCustomerPermission(context, CUSTOMER_PERMISSIONS.export, "You do not have permission to export customer data.");
  const addresses = kindOf(kind) === "addresses";
  requireCustomerPermission(context, addresses ? CUSTOMER_PERMISSIONS.viewAddresses : CUSTOMER_PERMISSIONS.viewContacts, `You do not have permission to view customer ${kind}.`);
  const { finance, values, sql } = buildCustomerListWhere(context, filters);
  // The list's WHERE refers to the billing address and, for balance filters, the finance figures.
  const from = `FROM tenant.business_parties customer
    LEFT JOIN LATERAL (SELECT a.city, a.state, a.country_code FROM tenant.addresses a WHERE a.organization_id = customer.organization_id AND a.party_id = customer.id AND a.status = 'active'
                        ORDER BY a.is_default_billing DESC, a.created_at LIMIT 1) billing ON true
    ${finance ? `LEFT JOIN LATERAL (SELECT COALESCE(sum(i.outstanding_amount) FILTER (WHERE i.invoice_type <> 'credit_note' AND i.status IN ('posted', 'partially_paid', 'overdue', 'disputed')), 0) AS outstanding,
                               COALESCE(sum(i.outstanding_amount) FILTER (WHERE i.invoice_type <> 'credit_note' AND i.status IN ('posted', 'partially_paid', 'overdue', 'disputed') AND i.due_date < current_date), 0) AS overdue
                          FROM tenant.accounting_customer_invoices i WHERE i.organization_id = customer.organization_id AND i.party_id = customer.id) finance ON true` : ""}`;
  const customers = `SELECT customer.id, COALESCE(customer.customer_number, customer.code) AS number, customer.display_name ${from} ${sql}`;
  const bool = (value) => (value ? "Yes" : "No");
  let header;
  let body;
  if (addresses) {
    const { rows } = await client.query(
      `SELECT c.number, c.display_name, address.* FROM (${customers}) c JOIN tenant.addresses address ON address.organization_id = $1 AND address.party_id = c.id
        ORDER BY lower(c.display_name), address.status = 'active' DESC, address.is_default_billing DESC, address.created_at LIMIT ${EXPORT_ROW_LIMIT + 1}`, values);
    header = ["Customer Number", "Customer Name", "Address Label", "Address Type", "Address Line 1", "Address Line 2", "City", "District", "State", "State Code", "Postal Code", "Country Code",
      "GSTIN", "Contact Person", "Phone", "Email", "Default Billing", "Default Shipping", "Active"];
    body = rows.map((row) => [row.number, row.display_name, row.label, CUSTOMER_ADDRESS_TYPES.find((entry) => entry.code === row.address_type)?.label ?? row.address_type, row.line1, row.line2,
      row.city, row.district, row.state, row.state_code, row.postal_code, row.country_code?.trim(), row.gstin, row.contact_person, row.phone, row.email, bool(row.is_default_billing),
      bool(row.is_default_shipping), bool(row.status === "active")]);
  } else {
    const { rows } = await client.query(
      `SELECT c.number, c.display_name AS customer_name, link.*, contact.first_name, contact.last_name, contact.email, COALESCE(contact.mobile, contact.phone) AS contact_phone,
              contact.status AS contact_status, address.label AS address_label
         FROM (${customers}) c
         JOIN tenant.crm_contact_account_relationships link ON link.organization_id = $1 AND link.party_id = c.id
         JOIN tenant.contacts contact ON contact.organization_id = link.organization_id AND contact.id = link.contact_id AND contact.status <> 'archived'
         LEFT JOIN tenant.addresses address ON address.organization_id = link.organization_id AND address.id = link.address_id
        ORDER BY lower(c.display_name), link.status = 'active' DESC, link.is_primary_contact DESC, lower(contact.first_name) LIMIT ${EXPORT_ROW_LIMIT + 1}`, values);
    header = ["Customer Number", "Customer Name", "First Name", "Last Name", "Email", "Mobile", "Job Title", "Department", "Role", "Address Label", "Primary Contact", "Billing Contact",
      "Delivery Contact", "Procurement Contact", "Notes", "Active"];
    body = rows.map((row) => [row.number, row.customer_name, row.first_name, row.last_name, row.email, row.contact_phone, row.job_title, row.department,
      CUSTOMER_CONTACT_ROLES.find((entry) => entry.code === row.role)?.label ?? row.role, row.address_label, bool(row.is_primary_contact), bool(row.is_billing_contact),
      bool(row.is_shipping_contact), bool(row.is_procurement_contact), row.notes, bool(row.status === "active" && row.contact_status === "active")]);
  }
  if (body.length > EXPORT_ROW_LIMIT) throw new CustomerError(413, `More than ${EXPORT_ROW_LIMIT} rows match. Narrow the filters and export again.`, "SALES_CUSTOMER_EXPORT_TOO_LARGE");
  return { fileName: `customer-${kind}-${new Date().toISOString().slice(0, 10)}.csv`, csv: toCsv([header, ...body]), count: body.length };
}
