import { SalesError } from "./index.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, label) => {
  if (!UUID.test(String(value || ""))) throw new SalesError(400, `${label} is invalid.`, "SALES_REFERENCE_INVALID");
  return String(value);
};
const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const can = (c, permission) => c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(permission);
const need = (c, permission) => {
  if (!can(c, permission)) throw new SalesError(403, "You do not have permission to perform this Sales operation.");
};
const clampLimit = (value, fallback = 100) => Math.min(Math.max(Number.isFinite(Number(value)) ? Number(value) : fallback, 1), 500);
const clampOffset = (value) => Math.max(Number.isFinite(Number(value)) ? Number(value) : 0, 0);

// Read/create surface for the Sales price-list admin UI. The write
// operations for items and customer-specific prices already live in
// pass1-operations.js (upsertSalesPriceListItem / upsertSalesCustomerPrice /
// deactivate*); this file only adds what a management screen also needs and
// nothing else in the codebase exposed: listing the price-list headers,
// creating one, and listing a list's items and the customer-specific rules.
export async function listSalesPriceLists(client, c) {
  need(c, "sales.view");
  const result = await client.query(
    `SELECT list.id, list.code, list.name, list.currency_code, list.tax_inclusive, list.valid_from::text AS valid_from, list.valid_to::text AS valid_to, list.status,
            (SELECT count(*)::int FROM tenant.price_list_items item
              WHERE item.organization_id=list.organization_id AND item.price_list_id=list.id AND item.status='active') AS item_count,
            (SELECT count(*)::int FROM tenant.pos_stores store
              WHERE store.organization_id=list.organization_id AND store.price_list_id=list.id) AS assigned_store_count
       FROM tenant.price_lists list
      WHERE list.organization_id=$1 AND list.price_list_type='sales'
      ORDER BY list.status ASC, list.name ASC
      LIMIT 200`,
    [c.organizationId],
  );
  return { rows: result.rows };
}

export async function createSalesPriceList(client, c, input = {}) {
  need(c, "sales.settings.manage");
  const code = text(input.code, 40).toUpperCase();
  const name = text(input.name, 200);
  const currencyCode = text(input.currencyCode || "INR", 3).toUpperCase();
  if (!code) throw new SalesError(400, "Price-list code is required.", "SALES_PRICE_LIST_CODE_REQUIRED");
  if (!name) throw new SalesError(400, "Price-list name is required.", "SALES_PRICE_LIST_NAME_REQUIRED");
  if (currencyCode.length !== 3) throw new SalesError(400, "Currency must be a 3-letter code.", "SALES_PRICE_LIST_CURRENCY_INVALID");
  const validFrom = input.validFrom || null;
  const validTo = input.validTo || null;
  if (validFrom && validTo && String(validFrom) > String(validTo))
    throw new SalesError(400, "Price-list valid-from date cannot be after valid-to date.", "SALES_PRICE_LIST_DATE_INVALID");
  const duplicate = await client.query(`SELECT 1 FROM tenant.price_lists WHERE organization_id=$1 AND code=$2`, [c.organizationId, code]);
  if (duplicate.rows[0]) throw new SalesError(409, `A price list with code ${code} already exists.`, "SALES_PRICE_LIST_CODE_DUPLICATE");
  const created = await client.query(
    `INSERT INTO tenant.price_lists(organization_id,code,name,price_list_type,currency_code,tax_inclusive,valid_from,valid_to,created_by,updated_by)
     VALUES($1,$2,$3,'sales',$4,$5,$6,$7,$8,$8) RETURNING id,code,name,currency_code,tax_inclusive,valid_from::text AS valid_from,valid_to::text AS valid_to,status`,
    [c.organizationId, code, name, currencyCode, Boolean(input.taxInclusive), validFrom, validTo, c.userId],
  );
  return created.rows[0];
}

export async function listSalesPriceListItems(client, c, priceListId, { limit, offset } = {}) {
  need(c, "sales.view");
  const id = uuid(priceListId, "Price list");
  const list = await client.query(
    `SELECT id,code,name,currency_code FROM tenant.price_lists WHERE organization_id=$1 AND id=$2 AND price_list_type='sales'`,
    [c.organizationId, id],
  );
  if (!list.rows[0]) throw new SalesError(404, "Sales price list not found.", "SALES_PRICE_LIST_NOT_FOUND");
  const rows = await client.query(
    `SELECT price.id, price.item_id, item.code AS item_code, item.name AS item_name, price.variant_id, variant.sku AS variant_sku,
            price.uom_id, price.minimum_quantity, price.rate, price.valid_from::text AS valid_from, price.valid_to::text AS valid_to, price.status,
            count(*) OVER()::int AS total
       FROM tenant.price_list_items price
       JOIN tenant.items item ON item.organization_id=price.organization_id AND item.id=price.item_id
       LEFT JOIN tenant.item_variants variant ON variant.organization_id=price.organization_id AND variant.id=price.variant_id
      WHERE price.organization_id=$1 AND price.price_list_id=$2 AND price.status='active'
      ORDER BY item.name ASC, price.minimum_quantity ASC, price.valid_from ASC NULLS FIRST
      LIMIT $3 OFFSET $4`,
    [c.organizationId, id, clampLimit(limit, 100), clampOffset(offset)],
  );
  return { priceList: list.rows[0], rows: rows.rows.map(({ total, ...row }) => row), total: rows.rows[0]?.total ?? 0 };
}

export async function listSalesPricingOptions(client, c) {
  need(c, "sales.view");
  const companyId = c.activeCompanyId || null;
  const [items, customers, uoms, variants] = await Promise.all([
    client.query(
      `SELECT id,code,name,uom_id FROM tenant.items WHERE organization_id=$1 AND status='active' AND ($2::uuid IS NULL OR company_id IS NULL OR company_id=$2) ORDER BY name LIMIT 500`,
      [c.organizationId, companyId],
    ),
    client.query(
      `SELECT id,code,display_name FROM tenant.business_parties WHERE organization_id=$1 AND status='active' AND party_type IN ('customer','both') AND ($2::uuid IS NULL OR company_id IS NULL OR company_id=$2) ORDER BY display_name LIMIT 500`,
      [c.organizationId, companyId],
    ),
    client.query(`SELECT id,code,name FROM tenant.units_of_measure WHERE organization_id=$1 AND status='active' ORDER BY name LIMIT 200`, [c.organizationId]),
    client.query(`SELECT id,item_id,sku,name FROM tenant.item_variants WHERE organization_id=$1 AND status='active' ORDER BY sku LIMIT 1000`, [c.organizationId]),
  ]);
  return { items: items.rows, customers: customers.rows, uoms: uoms.rows, variants: variants.rows };
}

export async function listSalesCustomerPrices(client, c, { partyId, limit, offset } = {}) {
  need(c, "sales.view");
  const values = [c.organizationId];
  let scope = "";
  if (!c.allowAllCompanies) {
    if (c.activeCompanyId) {
      values.push(c.activeCompanyId);
      scope = ` AND (rule.company_id IS NULL OR rule.company_id=$${values.length})`;
    } else scope = " AND false";
  }
  if (partyId) {
    values.push(uuid(partyId, "Customer"));
    scope += ` AND rule.party_id=$${values.length}`;
  }
  values.push(clampLimit(limit, 100), clampOffset(offset));
  const rows = await client.query(
    `SELECT rule.id, rule.party_id, party.display_name AS party_name, rule.item_id, item.code AS item_code, item.name AS item_name,
            rule.price_list_id, rule.minimum_quantity, rule.adjustment_value AS fixed_rate, rule.valid_from::text AS valid_from, rule.valid_to::text AS valid_to, rule.reason,
            count(*) OVER()::int AS total
       FROM tenant.sales_pricing_rules rule
       JOIN tenant.business_parties party ON party.organization_id=rule.organization_id AND party.id=rule.party_id
       JOIN tenant.items item ON item.organization_id=rule.organization_id AND item.id=rule.item_id
      WHERE rule.organization_id=$1 AND rule.party_type='customer' AND rule.adjustment_type='fixed_rate' AND rule.status='active'${scope}
      ORDER BY party.display_name ASC, item.name ASC
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return { rows: rows.rows.map(({ total, ...row }) => row), total: rows.rows[0]?.total ?? 0 };
}
