// A line outside the catalogue (report Phase 3) on a purchase request, price request, quotation or rate contract — "AMC for the chiller",
// "Printing of 500 brochures". The same rule as an order's one-off line: a description and a unit, bought as a service or a non-stock
// purchase, never stock. Its expense account and tax may be chosen later; they are needed by the time it is ordered.
import { PO_PERMISSIONS, fail, optionalUuid, text } from "./constants.js";
import { poCan } from "./access.js";

export const ONE_OFF_TYPES = Object.freeze([{ code: "service", label: "Service" }, { code: "non_stock", label: "Non-stock purchase" }]);

// The one-off part of an input line: { description, uomId, oneOffType, expenseAccountId, taxCategoryId, noTax }. label names the line.
export async function readOneOffLine(client, organizationId, line, label, { checkPermission = null } = {}) {
  if (checkPermission && !poCan(checkPermission, PO_PERMISSIONS.descriptiveLines))
    fail(`${label}: you may only ask for items from the catalogue.`, "productId", "PERMISSION_DENIED", 403);
  const description = text(line.description, 1000);
  if (!description) fail(`${label}: describe what is needed, or choose an item.`, "description", "ONE_OFF_DESCRIPTION_REQUIRED");
  const uomId = optionalUuid(line.uomId, `${label} unit`);
  if (!uomId) fail(`${label}: choose the unit.`, "uomId", "ONE_OFF_UNIT_REQUIRED");
  const uom = (await client.query(`SELECT id FROM tenant.units_of_measure WHERE organization_id = $1 AND id = $2`, [organizationId, uomId])).rows[0];
  if (!uom) fail(`${label}: the unit was not found.`, "uomId", "ONE_OFF_UNIT_INVALID", 409);
  const oneOffType = line.oneOffType === "non_stock" || line.productType === "non_stock" ? "non_stock" : "service";
  const expenseAccountId = optionalUuid(line.expenseAccountId, `${label} expense account`);
  if (expenseAccountId && !(await client.query(`SELECT 1 FROM tenant.accounting_accounts WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [organizationId, expenseAccountId])).rowCount)
    fail(`${label}: the expense account was not found.`, "expenseAccountId", "ONE_OFF_ACCOUNT_INVALID", 409);
  const taxCategoryId = optionalUuid(line.taxCategoryId, `${label} tax category`);
  return { itemId: null, description, uomId, oneOffType, expenseAccountId, taxCategoryId, noTax: line.noTax === true };
}

// The order line a one-off line becomes, with what the buyer chose when ordering (entry) over what the line carried.
export function oneOffOrderLine(line, entry, label) {
  const expenseAccountId = optionalUuid(entry?.expenseAccountId, `${label} expense account`) ?? line.expenseAccountId ?? null;
  if (!expenseAccountId) fail(`${label}: choose the expense account "${line.description}" is booked to.`, "expenseAccountId", "ONE_OFF_ACCOUNT_REQUIRED");
  const taxCategoryId = optionalUuid(entry?.taxCategoryId, `${label} tax category`) ?? line.taxCategoryId ?? null;
  const noTax = entry?.noTax === true || (!taxCategoryId && line.noTax === true);
  if (!taxCategoryId && !noTax) fail(`${label}: choose the tax category for "${line.description}", or mark it as not taxed.`, "taxCategoryId", "ONE_OFF_TAX_REQUIRED");
  return { productId: undefined, productType: line.oneOffType ?? "service", description: line.description, uomId: line.uomId, expenseAccountId, ...(taxCategoryId ? { taxCategoryId } : { noTax: true }) };
}

// The SELECT pieces for a line that may or may not have an item: its name, and the one-off fields as they come back.
export const oneOffView = (row) => ({
  oneOff: !row.item_id, oneOffType: row.one_off_type ?? null, expenseAccountId: row.expense_account_id ?? null, taxCategoryId: row.tax_category_id ?? null, noTax: Boolean(row.one_off_no_tax),
});
