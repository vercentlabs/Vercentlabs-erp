// The suppliers and purchasable items a Procurement form or filter chooses from (Procurement plan Phase 0, bug 6). Forms used to load
// 2,000 suppliers and 5,000 items, each with a last-price subquery, and anything past the cap could not be picked. Now a form gets a
// first page (active suppliers first, then by name) plus whatever it already holds (`ids`), and finds the rest by typing — the search
// runs on the server over name, number, GSTIN (suppliers) or name, code, SKU, barcode, HSN (items). Every row has one shape, whichever
// screen asks: a supplier's GSTIN and MSME status for the picker's label, an item's last purchase price from the chosen supplier first.
import { isUuid } from "./purchase-orders/constants.js";

export const FIRST_PAGE = 50;
const SEARCH_LIMIT = 30;

const likeOf = (search) => `%${String(search ?? "").trim().toLowerCase().replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
const idsOf = (ids) => [...new Set((Array.isArray(ids) ? ids : String(ids ?? "").split(",")).map((id) => String(id).trim()).filter(isUuid))];

// The price last agreed for an item on a confirmed or closed order, the chosen supplier's own first (a suggestion only).
const lastPriceSql = (supplierParam) => `(SELECT line.unit_price FROM tenant.purchase_order_lines line
    JOIN tenant.purchase_orders po ON po.organization_id = line.organization_id AND po.id = line.purchase_order_id
   WHERE line.organization_id = item.organization_id AND line.product_id = item.id AND po.status IN ('confirmed', 'closed') AND line.unit_price IS NOT NULL
     AND line.purchase_uom_id = COALESCE(item.purchase_uom_id, item.uom_id)
   ORDER BY ${supplierParam ? `(po.supplier_id = ${supplierParam}) DESC, ` : ""}po.order_date DESC, po.created_at DESC LIMIT 1)`;

function supplierRow(row) {
  const name = row.name;
  return {
    id: row.id, supplier_number: row.supplier_number, name, display_name: name, label: `${name} · ${row.supplier_number}`,
    status: row.status, selectable: row.status === "active", currency_code: row.currency_code, payment_term_id: row.payment_term_id,
    withholding_section_id: row.withholding_section_id, gstin: row.gstin ?? null, msme: Boolean(row.msme_registration_number || row.msme_classification),
    purchase_warning: row.purchase_warning ?? null,
  };
}

// { search?, ids?, limit?, activeOnly?, only? } → supplier rows. Without a search: the first page plus `ids`; with one: the matches; only: just `ids`.
export async function supplierOptions(client, organizationId, { search = "", ids = [], limit, activeOnly = false, only = false } = {}) {
  const values = [organizationId];
  const bind = (value) => `$${values.push(value)}`;
  const select = `SELECT supplier.id, supplier.supplier_number, party.display_name AS name, supplier.status, btrim(supplier.default_currency) AS currency_code,
                         supplier.payment_term_id, supplier.withholding_section_id, party.gstin, supplier.msme_registration_number, supplier.msme_classification, supplier.purchase_warning
                    FROM tenant.procurement_suppliers supplier JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
                   WHERE supplier.organization_id = $1`;
  const active = activeOnly ? " AND supplier.status = 'active'" : "";
  const order = " ORDER BY (supplier.status = 'active') DESC, party.display_name";
  const term = String(search ?? "").trim();
  const rows = only ? []
    : term ? (await client.query(`${select}${active} AND lower(concat_ws(' ', party.display_name, party.legal_name, supplier.supplier_number, party.gstin)) LIKE ${bind(likeOf(term))}${order} LIMIT ${bind(Math.min(Number(limit) || SEARCH_LIMIT, 100))}`, values)).rows
    : (await client.query(`${select}${active}${order} LIMIT ${bind(Math.min(Number(limit) || FIRST_PAGE, 200))}`, values)).rows;
  const wanted = idsOf(ids).filter((id) => !rows.some((row) => row.id === id));
  if (wanted.length) rows.push(...(await client.query(`${select} AND supplier.id = ANY(${bind(wanted)}::uuid[])`, values)).rows);
  return rows.map(supplierRow);
}

// { search?, ids?, limit?, supplierId? } → purchasable item rows, each with its last purchase price (the supplier's own first).
export async function itemOptions(client, organizationId, { search = "", ids = [], limit, supplierId = null, only = false } = {}) {
  const values = [organizationId];
  const bind = (value) => `$${values.push(value)}`;
  const supplier = isUuid(supplierId) ? bind(supplierId) : null;
  // The chosen supplier's rate contract for the item in its purchase unit, active on the company's today and in the supplier's currency.
  const contractSql = supplier ? `(SELECT json_build_object('rate', line.rate, 'number', contract.contract_number) FROM tenant.purchase_rate_contract_lines line
      JOIN tenant.purchase_rate_contracts contract ON contract.organization_id = line.organization_id AND contract.id = line.contract_id
     WHERE line.organization_id = item.organization_id AND line.item_id = item.id AND line.uom_id IS NOT DISTINCT FROM COALESCE(item.purchase_uom_id, item.uom_id)
       AND contract.supplier_id = ${supplier} AND contract.status = 'active'
       AND (SELECT (now() AT TIME ZONE COALESCE(NULLIF(org.timezone, ''), 'Asia/Kolkata'))::date FROM public.organizations org WHERE org.id = item.organization_id)
           BETWEEN contract.valid_from AND contract.valid_to
       AND btrim(contract.currency_code) = (SELECT btrim(own.default_currency) FROM tenant.procurement_suppliers own WHERE own.organization_id = item.organization_id AND own.id = ${supplier})
     LIMIT 1)` : "NULL::json";
  // The chosen supplier's current listed rate (Supplier Rates) in the purchase unit, from the smallest quantity.
  const listedSql = supplier ? `(SELECT json_build_object('rate', price.rate, 'code', price.supplier_item_code, 'lead', price.lead_time_days) FROM tenant.procurement_supplier_prices price
     WHERE price.organization_id = item.organization_id AND price.item_id = item.id AND price.supplier_id = ${supplier} AND price.status = 'active'
       AND price.uom_id IS NOT DISTINCT FROM COALESCE(item.purchase_uom_id, item.uom_id)
       AND (SELECT (now() AT TIME ZONE COALESCE(NULLIF(org.timezone, ''), 'Asia/Kolkata'))::date FROM public.organizations org WHERE org.id = item.organization_id)
           BETWEEN price.valid_from AND COALESCE(price.valid_to, 'infinity'::date)
     ORDER BY price.minimum_quantity LIMIT 1)` : "NULL::json";
  const select = `SELECT item.id, item.code, item.name, item.item_type, item.track_inventory, item.purchase_uom_id, item.uom_id, item.tax_category_id, item.purchase_warning, item.purchase_warning_level,
                         ${lastPriceSql(supplier)} AS last_purchase_price, ${contractSql} AS contract, ${listedSql} AS listed
                    FROM tenant.items item WHERE item.organization_id = $1`;
  const usable = " AND item.status = 'active' AND item.is_purchasable";
  const term = String(search ?? "").trim();
  const rows = only ? []
    : term ? (await client.query(`${select}${usable} AND lower(concat_ws(' ', item.code, item.sku, item.name, item.barcode, item.hsn_sac_code)) LIKE ${bind(likeOf(term))} ORDER BY item.name LIMIT ${bind(Math.min(Number(limit) || SEARCH_LIMIT, 100))}`, values)).rows
    : (await client.query(`${select}${usable} ORDER BY item.name LIMIT ${bind(Math.min(Number(limit) || FIRST_PAGE, 200))}`, values)).rows;
  const wanted = idsOf(ids).filter((id) => !rows.some((row) => row.id === id));
  if (wanted.length) rows.push(...(await client.query(`${select} AND item.id = ANY(${bind(wanted)}::uuid[])`, values)).rows);
  return rows.map(({ contract, listed, ...row }) => ({ ...row, label: `${row.name} (${row.code})`, last_purchase_price: row.last_purchase_price === null ? null : String(row.last_purchase_price),
    contract_rate: contract ? String(contract.rate) : null, contract_number: contract?.number ?? null,
    supplier_rate: listed ? String(listed.rate) : null, supplier_item_code: listed?.code ?? null, lead_time_days: listed?.lead ?? null }));
}

// GET /api/procurement/options/search?kind=suppliers|products&search=&ids=&supplierId=&activeOnly=
// Asked for ids and no search (a picker naming the row it already holds), it returns just those rows.
export async function searchProcurementOptions(client, context, { kind, search = "", ids = [], supplierId = null, activeOnly = false } = {}) {
  const only = !String(search ?? "").trim() && idsOf(ids).length > 0;
  if (kind === "products" || kind === "items") return { products: await itemOptions(client, context.organizationId, { search, ids, supplierId, only }) };
  return { suppliers: await supplierOptions(client, context.organizationId, { search, ids, activeOnly, only }) };
}
