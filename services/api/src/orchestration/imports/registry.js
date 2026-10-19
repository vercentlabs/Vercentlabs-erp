// Shared imports (Shared Platform plan 5): the imports a company needs to move in that its apps did not have yet — warehouses and
// their bins, tax rates, the chart of accounts, open customer invoices and supplier bills (opening balances that can be collected and
// paid), bills of materials and employees. Each row goes through the owning app's own create function, so it gets the same checks
// and permissions as a record entered by hand; names and codes in the file are resolved to records here.
//
// An importer: key, moduleKey, label, description, permissions (any one lets the person see it; the app's function still decides),
// fields [{ key, label, aliases, sample, required }], optional groupBy (rows sharing that value become one record, such as a BOM's
// lines), and importRow(client, context, values | values[], lookups) → { reference, message }.
import { createAccountingAccount, getAccountMapping, getPrimaryLedger } from "../../modules/accounting/index.js";
import { createCustomerInvoice } from "../../modules/accounting/receivables.js";
import { createVendorBill } from "../../modules/accounting/payables.js";
import { createManufacturingBom } from "../../modules/manufacturing/boms/bom-service.js";
import { saveEmployee } from "../../modules/hr-payroll/workforce.js";
import { createWarehouse, createWarehouseLocation } from "../../modules/stock/warehouses.js";
import { createTaxCategory } from "../../core/tax/configuration.js";
import { gstStateCode } from "../../core/tax/index.js";

export class ImportRowError extends Error {
  constructor(message, field = null) {
    super(message);
    this.name = "ImportRowError";
    this.status = 400;
    this.code = "IMPORT_ROW_INVALID";
    if (field) this.details = { field };
  }
}

const key = (value) => String(value ?? "").trim().toLowerCase();
const yes = (value) => (value === undefined || value === null || value === "" ? undefined : ["yes", "y", "true", "1"].includes(key(value)));
const amount = (value, label, field) => {
  const cleaned = String(value ?? "").replace(/[₹,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) throw new ImportRowError(`${label} must be a number.`, field);
  return cleaned;
};
// Dates as Indian users type them: 31/03/2026, 31-03-2026 or 2026-03-31.
export function importDate(value, label, field) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
  const indian = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(raw);
  const [year, month, day] = iso ? [iso[1], iso[2], iso[3]] : indian ? [indian[3], indian[2], indian[1]] : [];
  const date = year ? `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}` : null;
  // A real calendar day (no 31/02 or month 13).
  const parsed = date ? new Date(`${date}T00:00:00Z`) : null;
  if (parsed && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date) return date;
  throw new ImportRowError(`${label}: use a date like 31/03/2026.`, field);
}

// Per-file lookups (cached): a record by its code or name, or a clear row error.
function lookups(client, context) {
  const cache = new Map();
  const find = async (cacheKey, sql, value, message, field) => {
    const k = `${cacheKey}:${key(value)}`;
    if (!cache.has(k)) cache.set(k, (await client.query(sql, [context.organizationId, key(value)])).rows[0] ?? null);
    const row = cache.get(k);
    if (!row) throw new ImportRowError(message, field);
    return row;
  };
  return {
    item: (value, field = "itemCode") => find("item", `SELECT id, code, uom_id FROM tenant.items WHERE organization_id = $1 AND (lower(code) = $2 OR lower(sku) = $2) LIMIT 1`,
      value, `No product has the code or SKU "${value}".`, field),
    uom: (value, field = "unit") => find("uom", `SELECT id FROM tenant.units_of_measure WHERE organization_id = $1 AND (lower(code) = $2 OR lower(symbol) = $2 OR lower(name) = $2) LIMIT 1`,
      value, `No unit "${value}".`, field),
    warehouse: (value, field = "warehouseCode") => find("warehouse", `SELECT id FROM tenant.warehouses WHERE organization_id = $1 AND (lower(code) = $2 OR lower(name) = $2) LIMIT 1`,
      value, `No warehouse "${value}".`, field),
    party: (value, kinds, field = "party") => find(`party-${kinds.join("")}`,
      `SELECT id FROM tenant.business_parties WHERE organization_id = $1 AND party_type = ANY('{${kinds.join(",")}}'::text[])
          AND (lower(code) = $2 OR lower(customer_number) = $2 OR lower(display_name) = $2 OR lower(gstin) = $2) ORDER BY (lower(code) = $2) DESC LIMIT 1`,
      value, `No ${kinds.includes("supplier") ? "supplier" : "customer"} "${value}" (use its number, name or GSTIN).`, field),
    account: (value, field = "parentCode") => find("account", `SELECT id FROM tenant.accounting_accounts WHERE organization_id = $1 AND lower(code) = $2 AND status = 'active' LIMIT 1`,
      value, `No account with the code "${value}".`, field),
    department: (value) => find("department", `SELECT id FROM tenant.hr_departments WHERE organization_id = $1 AND (lower(code) = $2 OR lower(name) = $2) LIMIT 1`,
      value, `No department "${value}".`, "department"),
    designation: (value) => find("designation", `SELECT id FROM tenant.hr_designations WHERE organization_id = $1 AND (lower(code) = $2 OR lower(name) = $2) LIMIT 1`,
      value, `No designation "${value}".`, "designation"),
  };
}

// The other side of an opening invoice or bill: Opening balance equity (Finance's mapping), so the balance lands on the customer or
// supplier and nothing reaches revenue or expense.
async function openingEquityAccount(client, context, date) {
  const ledger = await getPrimaryLedger(client, context);
  return (await getAccountMapping(client, context, ledger.id, "opening_balance_equity", { date })).account_id;
}

const ACCOUNT_CLASSES = { asset: "asset", assets: "asset", liability: "liability", liabilities: "liability", equity: "equity", capital: "equity", income: "revenue", revenue: "revenue",
  expense: "expense", expenses: "expense" };

export const IMPORTERS = Object.freeze([
  {
    key: "stock.warehouses",
    moduleKey: "stock",
    label: "Warehouses",
    description: "Your warehouses and godowns with their addresses. Each gets its MAIN location; add bins with the next import.",
    permissions: ["warehouses.create"],
    fields: [
      { key: "code", label: "Code", aliases: ["warehouse code"], sample: "PUNE-01", required: true },
      { key: "name", label: "Name", aliases: ["warehouse", "warehouse name"], sample: "Pune Main Godown", required: true },
      { key: "type", label: "Type", aliases: [], sample: "Standard" },
      { key: "line1", label: "Address Line 1", aliases: ["address", "street"], sample: "Plot 14, MIDC Bhosari" },
      { key: "line2", label: "Address Line 2", aliases: [], sample: "" },
      { key: "city", label: "City", aliases: ["town"], sample: "Pune" },
      { key: "state", label: "State", aliases: [], sample: "Maharashtra" },
      { key: "postalCode", label: "PIN", aliases: ["pincode", "pin code", "postal code", "zip"], sample: "411026" },
      { key: "countryCode", label: "Country", aliases: ["country code"], sample: "IN" },
      { key: "contactName", label: "Contact", aliases: ["contact name", "in charge"], sample: "Suresh Patil" },
      { key: "phone", label: "Phone", aliases: ["mobile"], sample: "+91 98220 11111" },
      { key: "email", label: "Email", aliases: [], sample: "" },
    ],
    async importRow(client, context, values) {
      const created = await createWarehouse(client, context, {
        code: values.code, name: values.name, type: /transit/i.test(values.type ?? "") ? "transit" : "stores",
        line1: values.line1, line2: values.line2, city: values.city, state: values.state, stateCode: values.state ? gstStateCode(values.state) ?? null : null,
        postalCode: values.postalCode, countryCode: (values.countryCode ?? "IN").slice(0, 2).toUpperCase(), contactName: values.contactName, phone: values.phone, email: values.email,
      });
      return { reference: created.warehouse?.code ?? values.code, message: `Created warehouse ${values.code}.` };
    },
  },
  {
    key: "stock.locations",
    moduleKey: "stock",
    label: "Warehouse bins and locations",
    description: "Racks, shelves and bins inside a warehouse, under MAIN or under another location of the same warehouse.",
    permissions: ["warehouses.manage_locations"],
    fields: [
      { key: "warehouseCode", label: "Warehouse", aliases: ["warehouse code"], sample: "PUNE-01", required: true },
      { key: "code", label: "Location Code", aliases: ["code", "bin", "bin code"], sample: "RACK-A01", required: true },
      { key: "name", label: "Location Name", aliases: ["name"], sample: "Rack A shelf 1", required: true },
      { key: "parentCode", label: "Inside Location", aliases: ["parent", "parent code"], sample: "" },
      { key: "purpose", label: "Purpose", aliases: [], sample: "Storage" },
    ],
    async importRow(client, context, values, find) {
      const warehouse = await find.warehouse(values.warehouseCode);
      let parentLocationId = null;
      if (values.parentCode) {
        parentLocationId = (await client.query(`SELECT id FROM tenant.warehouse_locations WHERE organization_id = $1 AND warehouse_id = $2 AND upper(btrim(code)) = upper($3)`,
          [context.organizationId, warehouse.id, values.parentCode])).rows[0]?.id;
        if (!parentLocationId) throw new ImportRowError(`${values.warehouseCode} has no location ${values.parentCode} (put it higher in the file).`, "parentCode");
      }
      const purpose = { storage: "storage", receiving: "receiving", "quality hold": "quality_hold", returns: "returns", shipping: "shipping", transit: "transit" }[key(values.purpose)] ?? "storage";
      await createWarehouseLocation(client, context, warehouse.id, { code: values.code, name: values.name, parentLocationId, purpose });
      return { reference: `${values.warehouseCode}/${values.code}`, message: `Added ${values.code} to ${values.warehouseCode}.` };
    },
  },
  {
    key: "tax.rates",
    moduleKey: "sales",
    label: "Tax rates",
    description: "Tax categories with their rate (for example GST 18%, or exempt). Products then pick them.",
    permissions: ["tax.categories.manage"],
    fields: [
      { key: "code", label: "Code", aliases: [], sample: "GST-18", required: true },
      { key: "name", label: "Name", aliases: [], sample: "GST 18%", required: true },
      { key: "rate", label: "Rate %", aliases: ["rate", "gst rate", "percent"], sample: "18" },
      { key: "cessRate", label: "Cess %", aliases: ["cess", "cess rate"], sample: "" },
      { key: "treatment", label: "Treatment", aliases: [], sample: "Taxable" },
      { key: "appliesTo", label: "Applies To", aliases: ["for"], sample: "All" },
      { key: "effectiveFrom", label: "Effective From", aliases: ["from"], sample: "01/07/2017" },
    ],
    async importRow(client, context, values) {
      // Nil-rated is taxable at 0%; "non-GST" is outside tax.
      const treatment = { taxable: "taxable", exempt: "exempt", "nil rated": "taxable", nil: "taxable", "non gst": "non_taxable", "non taxable": "non_taxable", "zero rated": "zero_rated" }[key(values.treatment)] ?? "taxable";
      const appliesTo = { goods: "goods", services: "services", all: "all", both: "all" }[key(values.appliesTo)] ?? "all";
      await createTaxCategory(client, context, { code: values.code, name: values.name, treatment, appliesTo, rate: values.rate ?? "0", cessRate: values.cessRate ?? "0",
        effectiveFrom: importDate(values.effectiveFrom, "Effective From", "effectiveFrom") ?? undefined });
      return { reference: values.code.toUpperCase(), message: `Created ${values.code.toUpperCase()}.` };
    },
  },
  {
    key: "accounting.accounts",
    moduleKey: "accounting",
    label: "Chart of accounts",
    description: "Your ledger accounts and groups (Tally groups map to account groups). Put a group above the accounts inside it.",
    permissions: ["accounting.settings.manage"],
    fields: [
      { key: "code", label: "Account Code", aliases: ["code"], sample: "4100", required: true },
      { key: "name", label: "Account Name", aliases: ["name", "ledger", "ledger name"], sample: "Sales - Domestic", required: true },
      { key: "accountClass", label: "Class", aliases: ["nature", "primary group"], sample: "Income", required: true },
      { key: "accountType", label: "Type", aliases: ["account type"], sample: "revenue" },
      { key: "parentCode", label: "Group Code", aliases: ["parent", "parent code", "under"], sample: "4000" },
      { key: "isGroup", label: "Is Group", aliases: ["group"], sample: "No" },
    ],
    async importRow(client, context, values, find) {
      const accountClass = ACCOUNT_CLASSES[key(values.accountClass)];
      if (!accountClass) throw new ImportRowError("Class must be Asset, Liability, Equity, Income or Expense.", "accountClass");
      const isGroup = Boolean(yes(values.isGroup));
      const accountType = isGroup ? "group" : key(values.accountType).replace(/\s+/g, "_") || { asset: "current_asset", liability: "current_liability", equity: "equity", revenue: "revenue", expense: "expense" }[accountClass];
      const ledger = await getPrimaryLedger(client, context);
      await createAccountingAccount(client, context, {
        ledgerId: ledger.id, code: values.code, name: values.name, accountClass, accountType, isGroup, parentId: values.parentCode ? (await find.account(values.parentCode)).id : null,
        normalBalance: ["liability", "equity", "revenue"].includes(accountClass) ? "credit" : "debit",
      });
      return { reference: values.code, message: `Created ${values.code} ${values.name}.` };
    },
  },
  {
    key: "accounting.open_invoices",
    moduleKey: "accounting",
    label: "Open customer invoices",
    description: "What each customer still owes on the cut-over date, invoice by invoice, so it can be collected and aged. Created as opening invoices (drafts for Finance to post).",
    permissions: ["accounting.receivables.manage"],
    fields: [
      { key: "customer", label: "Customer", aliases: ["customer number", "customer name", "party"], sample: "CUST-000012", required: true },
      { key: "invoiceNumber", label: "Original Invoice Number", aliases: ["invoice number", "invoice no", "bill no"], sample: "INV/2526/00412", required: true },
      { key: "invoiceDate", label: "Invoice Date", aliases: ["date"], sample: "15/02/2026", required: true },
      { key: "dueDate", label: "Due Date", aliases: ["due"], sample: "17/03/2026" },
      { key: "amount", label: "Amount Due", aliases: ["balance", "outstanding", "amount"], sample: "118000", required: true },
      { key: "currencyCode", label: "Currency", aliases: [], sample: "INR" },
    ],
    async importRow(client, context, values, find) {
      const party = await find.party(values.customer, ["customer", "both"], "customer");
      const invoiceDate = importDate(values.invoiceDate, "Invoice Date", "invoiceDate");
      const due = amount(values.amount, "Amount Due", "amount");
      const created = await createCustomerInvoice(client, context, {
        partyId: party.id, invoiceType: "opening", invoiceDate, dueDate: importDate(values.dueDate, "Due Date", "dueDate") ?? undefined, currencyCode: values.currencyCode,
        supplyType: "non_gst", notes: `Opening balance: original invoice ${values.invoiceNumber}`,
        lines: [{ description: `Opening balance — invoice ${values.invoiceNumber} of ${values.invoiceDate}`, quantity: "1", unitPrice: due, accountId: await openingEquityAccount(client, context, invoiceDate) }],
      });
      const invoice = created.invoice ?? created;
      return { reference: invoice.invoice_number ?? values.invoiceNumber, message: `Opening invoice for ${values.invoiceNumber} (₹${due}).` };
    },
  },
  {
    key: "accounting.open_bills",
    moduleKey: "accounting",
    label: "Open supplier bills",
    description: "What you still owe each supplier on the cut-over date, bill by bill, so it can be paid. Created as opening bills (drafts for Finance to post).",
    permissions: ["accounting.payables.manage"],
    fields: [
      { key: "supplier", label: "Supplier", aliases: ["supplier number", "supplier name", "vendor", "party"], sample: "SUP-000045", required: true },
      { key: "billNumber", label: "Supplier Invoice Number", aliases: ["bill number", "invoice number", "bill no"], sample: "SST/1123", required: true },
      { key: "billDate", label: "Bill Date", aliases: ["date", "invoice date"], sample: "20/02/2026", required: true },
      { key: "dueDate", label: "Due Date", aliases: ["due"], sample: "21/03/2026" },
      { key: "amount", label: "Amount Due", aliases: ["balance", "outstanding", "amount"], sample: "59000", required: true },
      { key: "currencyCode", label: "Currency", aliases: [], sample: "INR" },
    ],
    async importRow(client, context, values, find) {
      const party = await find.party(values.supplier, ["supplier", "both"], "supplier");
      const billDate = importDate(values.billDate, "Bill Date", "billDate");
      const due = amount(values.amount, "Amount Due", "amount");
      const created = await createVendorBill(client, context, {
        partyId: party.id, billType: "opening", billDate, dueDate: importDate(values.dueDate, "Due Date", "dueDate") ?? undefined, currencyCode: values.currencyCode,
        supplierInvoiceReference: values.billNumber, notes: `Opening balance: supplier invoice ${values.billNumber}`,
        lines: [{ description: `Opening balance — ${values.billNumber} of ${values.billDate}`, quantity: "1", unitPrice: due, accountId: await openingEquityAccount(client, context, billDate) }],
      });
      const bill = created.bill ?? created;
      return { reference: bill.bill_number ?? values.billNumber, message: `Opening bill for ${values.billNumber} (₹${due}).` };
    },
  },
  {
    key: "manufacturing.boms",
    moduleKey: "manufacturing",
    label: "Bills of materials",
    description: "What goes into each product: one row per material, the rows of a product together. Each becomes a draft BOM to review and approve.",
    permissions: ["manufacturing.bom.create"],
    groupBy: "productCode",
    fields: [
      { key: "productCode", label: "Product Code", aliases: ["product", "finished product", "finished good"], sample: "PUMP-1HP", required: true },
      { key: "outputQuantity", label: "Makes Quantity", aliases: ["output quantity", "batch quantity"], sample: "1" },
      { key: "componentCode", label: "Material Code", aliases: ["component", "component code", "material", "raw material"], sample: "MOTOR-1HP", required: true },
      { key: "quantity", label: "Quantity", aliases: ["qty", "component quantity"], sample: "1", required: true },
      { key: "unit", label: "Unit", aliases: ["uom"], sample: "" },
      { key: "scrapPercent", label: "Scrap %", aliases: ["scrap", "wastage"], sample: "0" },
    ],
    async importRow(client, context, rows, find) {
      const product = await find.item(rows[0].productCode, "productCode");
      const lines = [];
      for (const row of rows) {
        const component = await find.item(row.componentCode, "componentCode");
        lines.push({ componentItemId: component.id, quantity: amount(row.quantity, "Quantity", "quantity"), uomId: row.unit ? (await find.uom(row.unit)).id : component.uom_id,
          scrapAllowancePct: row.scrapPercent ?? 0 });
      }
      const created = await createManufacturingBom(client, context, { finishedItemId: product.id, outputQuantity: rows[0].outputQuantity ?? "1", lines });
      return { reference: created.bomNumber ?? created.bom?.bomNumber ?? product.code, message: `Draft BOM for ${product.code} with ${lines.length} material${lines.length === 1 ? "" : "s"}.` };
    },
  },
  {
    key: "hr.employees",
    moduleKey: "hr-payroll",
    label: "Employees",
    description: "Your people: name, joining date, department, designation, manager and PAN. Salaries are set up in Payroll.",
    permissions: ["hr_payroll.employee.manage"],
    fields: [
      { key: "firstName", label: "First Name", aliases: ["first"], sample: "Anita", required: true },
      { key: "lastName", label: "Last Name", aliases: ["last", "surname"], sample: "Deshmukh", required: true },
      { key: "workEmail", label: "Work Email", aliases: ["email", "office email"], sample: "anita@yourcompany.in" },
      { key: "personalEmail", label: "Personal Email", aliases: [], sample: "" },
      { key: "mobile", label: "Mobile", aliases: ["phone"], sample: "+91 98220 22222" },
      { key: "joiningDate", label: "Joining Date", aliases: ["date of joining", "doj"], sample: "01/04/2024", required: true },
      { key: "dateOfBirth", label: "Date of Birth", aliases: ["dob", "birth date"], sample: "" },
      { key: "employmentType", label: "Employment Type", aliases: ["type"], sample: "Permanent" },
      { key: "department", label: "Department", aliases: [], sample: "Production" },
      { key: "designation", label: "Designation", aliases: ["title", "job title"], sample: "Supervisor" },
      { key: "managerEmail", label: "Manager Work Email", aliases: ["manager", "reporting manager"], sample: "" },
      { key: "pan", label: "PAN", aliases: [], sample: "" },
    ],
    async importRow(client, context, values, find) {
      let managerEmployeeId = null;
      if (values.managerEmail) {
        managerEmployeeId = (await client.query(`SELECT id FROM tenant.hr_employees WHERE organization_id = $1 AND lower(work_email) = lower($2) AND status <> 'separated' LIMIT 1`,
          [context.organizationId, values.managerEmail])).rows[0]?.id;
        if (!managerEmployeeId) throw new ImportRowError(`No employee has the work email ${values.managerEmail} (put managers higher in the file).`, "managerEmail");
      }
      const created = await saveEmployee(client, context, {
        firstName: values.firstName, lastName: values.lastName, workEmail: values.workEmail, personalEmail: values.personalEmail,
        joiningDate: importDate(values.joiningDate, "Joining Date", "joiningDate"), dateOfBirth: importDate(values.dateOfBirth, "Date of Birth", "dateOfBirth"),
        employmentType: key(values.employmentType).replace(/\s+/g, "_") || "permanent",
        departmentId: values.department ? (await find.department(values.department)).id : null, designationId: values.designation ? (await find.designation(values.designation)).id : null,
        managerEmployeeId, pan: values.pan, workPhone: values.mobile,
      });
      return { reference: created.employee_number ?? created.employeeNumber ?? `${values.firstName} ${values.lastName}`, message: `Added ${values.firstName} ${values.lastName}.` };
    },
  },
]);

export function getImporter(importerKey) {
  return IMPORTERS.find((importer) => importer.key === importerKey) ?? null;
}
export { lookups as importLookups };
