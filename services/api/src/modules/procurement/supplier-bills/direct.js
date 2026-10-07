// Direct supplier bills (without a purchase order): rent, utilities, internet, subscriptions, professional fees, repairs, freight, consumables.
// Not a separate document or service: a supplier bill whose source is 'direct', created, validated, posted, paid and corrected through the same
// supplier bill operations. This file holds only what is particular to it — the supplier's defaults for a new bill, line-by-line editing of a
// draft, the account and tax checks of its expense lines, and the expense categories its lines are classified with. It never creates a
// purchase order, a goods receipt or a stock movement.
import { formatDecimal } from "../../../core/decimal.js";
import { TaxError, loadTaxContext, resolveLineTax } from "../../../core/tax/index.js";
import { requirePoPermission } from "../purchase-orders/access.js";
import { createDirectExpenseBill, loadBill, requireBillAccess, requireBillCreate, updateDraftSupplierBill, validateDirectBillAccount } from "./bills.js";
import { BILL_PERMISSIONS, SupplierBillError, fail, optionalUuid, requireUuid, text } from "./constants.js";
import { calculateSupplierBillBalance, getSupplierBill } from "./records.js";

export const createDirectSupplierBill = createDirectExpenseBill;

// resolveSupplierBillDefaults: what a new bill for this supplier starts from — currency, payment terms, the GSTIN (only when there is just one),
// billing address, usual TDS section and the default company registration. All editable on the draft.
export async function resolveSupplierBillDefaults(client, context, supplierId) {
  requireBillAccess(context);
  const organizationId = context.organizationId;
  const supplier = (await client.query(
    `SELECT supplier.id, supplier.supplier_number, supplier.status, supplier.blocked_reason, btrim(supplier.default_currency) AS currency_code, supplier.payment_term_id,
            supplier.withholding_section_id, party.display_name, party.legal_name, term.name AS payment_term_name, section.code AS section_code, section.rate AS section_rate
       FROM tenant.procurement_suppliers supplier JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
       LEFT JOIN tenant.payment_terms term ON term.organization_id = supplier.organization_id AND term.id = supplier.payment_term_id
       LEFT JOIN tenant.withholding_tax_sections section ON section.organization_id = supplier.organization_id AND section.id = supplier.withholding_section_id
      WHERE supplier.organization_id = $1 AND supplier.id = $2`, [organizationId, requireUuid(supplierId, "Supplier")])).rows[0];
  if (!supplier) throw new SupplierBillError(404, "Supplier not found.", "SUPPLIER_BILL_SUPPLIER_INVALID");
  const registrations = (await client.query(`SELECT id, gstin, state_code, registration_type, is_principal FROM tenant.procurement_supplier_tax_registrations
     WHERE organization_id = $1 AND supplier_id = $2 AND status = 'active' ORDER BY is_principal DESC, gstin`, [organizationId, supplier.id])).rows;
  const address = (await client.query(`SELECT id, label, line1, city, state_code FROM tenant.procurement_supplier_addresses WHERE organization_id = $1 AND supplier_id = $2 AND status = 'active'
     ORDER BY (address_type = 'billing') DESC, (address_type = 'registered') DESC, is_primary DESC, created_at LIMIT 1`, [organizationId, supplier.id])).rows[0] ?? null;
  const company = (await client.query(`SELECT id, name, registration_number AS gstin, state_code FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active'
     ORDER BY is_default DESC, created_at LIMIT 1`, [organizationId])).rows[0] ?? null;
  const warnings = [];
  if (supplier.status !== "active") warnings.push(`The supplier is ${supplier.status}${supplier.blocked_reason ? ` (${supplier.blocked_reason})` : ""}: only Accounts Payable records a bill for an existing obligation.`);
  if (registrations.length > 1) warnings.push("The supplier has several GSTINs: choose the one on the invoice.");
  return {
    supplierId: supplier.id, supplierNumber: supplier.supplier_number, supplierName: supplier.display_name, legalName: supplier.legal_name ?? supplier.display_name, status: supplier.status,
    currencyCode: supplier.currency_code, paymentTermId: supplier.payment_term_id, paymentTermName: supplier.payment_term_name,
    withholdingSection: supplier.withholding_section_id ? { id: supplier.withholding_section_id, code: supplier.section_code, rate: formatDecimal(supplier.section_rate) } : null,
    registrations: registrations.map((row) => ({ id: row.id, gstin: row.gstin, stateCode: row.state_code, registrationType: row.registration_type, principal: row.is_principal })),
    supplierTaxRegistrationId: registrations.length === 1 ? registrations[0].id : null, unregistered: registrations.length === 0,
    address: address ? { id: address.id, label: address.label, line1: address.line1, city: address.city, stateCode: address.state_code } : null,
    buyingRegistration: company ? { id: company.id, name: company.name, gstin: company.gstin, stateCode: company.state_code } : null, warnings,
  };
}

// The draft's direct lines as the bill operations take them.
async function directLinesOf(client, context, bill) {
  if (bill.source_type !== "direct") fail("Only a direct bill's expense lines are edited line by line.", "sourceType", "SUPPLIER_BILL_NOT_DIRECT", 409);
  if (bill.status !== "draft") throw new SupplierBillError(409, "Only a draft supplier bill can be changed.", "SUPPLIER_BILL_LOCKED");
  const rows = (await client.query(`SELECT * FROM tenant.accounting_vendor_bill_lines WHERE organization_id = $1 AND vendor_bill_id = $2 ORDER BY sequence`, [context.organizationId, bill.id])).rows;
  return rows.map((line) => ({
    id: line.id, expenseAccountId: line.expense_account_id, expenseCategoryId: line.expense_category_id, productId: line.item_id, description: line.description,
    quantity: formatDecimal(line.quantity), uomId: line.uom_id, unitPrice: formatDecimal(line.unit_price), discountType: line.line_discount_type, discountValue: formatDecimal(line.line_discount_value),
    taxCategoryId: line.tax_category_id, noTax: !line.tax_category_id, hsnSacCode: line.hsn_sac_code, costCenterId: line.cost_center_id, departmentId: line.department_id,
    inputTaxEligibility: line.input_tax_eligibility,
  }));
}
const strip = ({ id: _id, ...line }) => line;

// addDirectBillExpenseLine / updateDirectBillExpenseLine / removeDirectBillExpenseLine: one line of a draft direct bill; the bill is recalculated.
export async function addDirectBillExpenseLine(client, context, billId, line = {}) {
  requireBillCreate(context, "You do not have permission to edit supplier bills.");
  const bill = await loadBill(client, context, billId, { lock: true });
  const lines = await directLinesOf(client, context, bill);
  return updateDraftSupplierBill(client, context, bill.id, { lines: [...lines.map(strip), line] });
}
export async function updateDirectBillExpenseLine(client, context, billId, lineId, changes = {}) {
  requireBillCreate(context, "You do not have permission to edit supplier bills.");
  const bill = await loadBill(client, context, billId, { lock: true });
  const lines = await directLinesOf(client, context, bill);
  const id = requireUuid(lineId, "Bill line");
  if (!lines.some((line) => line.id === id)) throw new SupplierBillError(404, "That line is not on this bill.", "SUPPLIER_BILL_LINE_INVALID");
  return updateDraftSupplierBill(client, context, bill.id, { lines: lines.map((line) => strip(line.id === id ? { ...line, ...changes } : line)) });
}
export async function removeDirectBillExpenseLine(client, context, billId, lineId) {
  requireBillCreate(context, "You do not have permission to edit supplier bills.");
  const bill = await loadBill(client, context, billId, { lock: true });
  const lines = await directLinesOf(client, context, bill);
  const id = requireUuid(lineId, "Bill line");
  if (!lines.some((line) => line.id === id)) throw new SupplierBillError(404, "That line is not on this bill.", "SUPPLIER_BILL_LINE_INVALID");
  if (lines.length === 1) fail("A bill keeps at least one line; cancel the draft instead.", "lines", "SUPPLIER_BILL_NO_LINES");
  return updateDraftSupplierBill(client, context, bill.id, { lines: lines.filter((line) => line.id !== id).map(strip) });
}

// validateDirectBillAccounts: every line resolves to an active expense or asset account a supplier bill may post to (never inventory, cash or tax).
export async function validateDirectBillAccounts(client, context, lines = []) {
  requireBillAccess(context);
  const issues = [];
  for (const [index, line] of lines.entries()) {
    const label = `Line ${index + 1}`;
    try {
      const category = line.expenseCategoryId ? (await client.query(`SELECT account_id, status FROM tenant.expense_categories WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, requireUuid(line.expenseCategoryId, "Expense category")])).rows[0] : null;
      const accountId = line.expenseAccountId ?? category?.account_id;
      if (!accountId) { issues.push(`${label}: no expense or asset account.`); continue; }
      await validateDirectBillAccount(client, context, accountId, label);
    } catch (error) {
      issues.push(error.message);
    }
  }
  return { valid: issues.length === 0, issues };
}

// validateDirectBillTaxTreatment: each line's tax category resolves through the shared tax engine for this supplier and place of supply — or is
// reported as unrepresentable, never silently dropped.
export async function validateDirectBillTaxTreatment(client, context, { lines = [], supplierStateCode = null, placeOfSupply = null, billDate = null, buyingRegistrationId = null } = {}) {
  requireBillAccess(context);
  let tax;
  try { tax = await loadTaxContext(client, { organizationId: context.organizationId, sellerRegistrationId: optionalUuid(buyingRegistrationId, "Company registration") }); }
  catch (error) { return { valid: false, issues: [error.message] }; }
  const issues = [];
  for (const [index, line] of lines.entries()) {
    if (!line.taxCategoryId) continue;
    try {
      const resolved = await resolveLineTax(client, tax, { taxCategoryId: line.taxCategoryId, date: billDate ?? undefined, sellerStateCode: supplierStateCode, placeOfSupply });
      if (resolved.needsPlaceOfSupply) issues.push(`Line ${index + 1}: the supplier's state and the place of supply are needed to work out GST.`);
    } catch (error) {
      if (error instanceof TaxError) issues.push(`Line ${index + 1}: ${error.message}`); else throw error;
    }
  }
  return { valid: issues.length === 0, issues };
}

// getSupplierBillAccounting / getSupplierBillOutstandingBalance: the journals Finance posted for the bill, and what it still owes.
export async function getSupplierBillAccounting(client, context, billId) {
  const detail = await getSupplierBill(client, context, billId);
  return { accounting: detail.accounting, reconciliation: detail.reconciliation };
}
export const getSupplierBillOutstandingBalance = calculateSupplierBillBalance;

// ---------------------------------------------------------------- expense categories

const toCategory = (row) => ({ id: row.id, code: row.code, name: row.name, accountId: row.account_id, account: row.account_code ? `${row.account_code} · ${row.account_name}` : null,
  defaultTaxCategoryId: row.default_tax_category_id, defaultHsnSac: row.default_hsn_sac, status: row.status });

export async function listExpenseCategories(client, context, { includeInactive = false } = {}) {
  requireBillAccess(context);
  const { rows } = await client.query(
    `SELECT category.*, account.code AS account_code, account.name AS account_name FROM tenant.expense_categories category
       JOIN tenant.accounting_accounts account ON account.organization_id = category.organization_id AND account.id = category.account_id
      WHERE category.organization_id = $1${includeInactive ? "" : " AND category.status = 'active'"} ORDER BY category.name`, [context.organizationId]);
  return rows.map(toCategory);
}

// saveExpenseCategory: input { code, name, accountId, defaultTaxCategoryId?, defaultHsnSac?, status? }. Classification is controlled: its own permission.
export async function saveExpenseCategory(client, context, categoryId, input = {}) {
  requirePoPermission(context, BILL_PERMISSIONS.categories, "You do not have permission to manage expense categories.");
  const code = text(input.code, 30)?.toUpperCase();
  const name = text(input.name, 120);
  if (!code || !/^[A-Z0-9][A-Z0-9._-]*$/.test(code)) fail("Enter a short code using letters, digits, dots, dashes or underscores.", "code");
  if (!name) fail("Name the expense category.", "name");
  const account = await validateDirectBillAccount(client, context, input.accountId, "The category's account");
  const taxCategoryId = optionalUuid(input.defaultTaxCategoryId, "Tax category");
  if (taxCategoryId && !(await client.query(`SELECT 1 FROM tenant.tax_categories WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [context.organizationId, taxCategoryId])).rows[0])
    fail("Choose an active tax category.", "defaultTaxCategoryId", "SUPPLIER_BILL_CATEGORY_INVALID", 409);
  const values = [context.organizationId, code, name, account.id, taxCategoryId, text(input.defaultHsnSac, 8), input.status === "inactive" ? "inactive" : "active", context.userId ?? null];
  try {
    const row = categoryId
      ? (await client.query(`UPDATE tenant.expense_categories SET code = $2, name = $3, account_id = $4, default_tax_category_id = $5, default_hsn_sac = $6, status = $7, updated_by = $8, updated_at = now()
           WHERE organization_id = $1 AND id = $9 RETURNING *`, [...values, requireUuid(categoryId, "Expense category")])).rows[0]
      : (await client.query(`INSERT INTO tenant.expense_categories (organization_id, code, name, account_id, default_tax_category_id, default_hsn_sac, status, created_by, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING *`, values)).rows[0];
    if (!row) throw new SupplierBillError(404, "Expense category not found.", "SUPPLIER_BILL_CATEGORY_INVALID");
    return toCategory({ ...row, account_code: account.code, account_name: account.name });
  } catch (error) {
    if (error.code === "23505") throw new SupplierBillError(409, `An expense category ${code} already exists.`, "SUPPLIER_BILL_CATEGORY_DUPLICATE");
    throw error;
  }
}

