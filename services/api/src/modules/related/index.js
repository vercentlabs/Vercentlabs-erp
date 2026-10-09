// Related Documents: one shared answer to "what else belongs to this record?" for the record pages' Related tab — upstream sources and
// downstream documents, each a link to the page that owns it. Read only; nothing here changes a document.
//
//   purchase_order  supplier quotation, goods receipts, supplier bills, purchase returns, debit notes, vendor credits, replacement orders
//   opportunity     source lead, account, quotations, sales orders, invoices
//   lead            converted account, contact and opportunity, and that opportunity's quotations and orders
//   item            open sales orders, open purchase orders, recent goods receipts, open transfers, active quality holds
//
// The record itself is read through its own module first (getPurchaseOrder, getOpportunity, getLead, getProduct), so a record the person may
// not open answers exactly as its page would. Each group is included only when the person may open that kind of document; a group they may
// not see is absent, never an empty list.
import { getLead } from "../crm/leads/records.js";
import { getOpportunity } from "../crm/opportunities/records.js";
import { getProduct } from "../products/records.js";
import { getPurchaseOrder } from "../procurement/purchase-orders/records.js";

export const RELATED_DOCUMENT_TYPES = Object.freeze(["purchase_order", "opportunity", "lead", "item"]);

export class RelatedDocumentsError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, ...permissions) => privileged(c) || permissions.some((permission) => c.permissions?.includes(permission));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const day = (value) => (value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : value ?? null);
const LIMIT = 25;

// A document row: id, number, status, date, amount (decimal string) and currency where it has them, and the page that owns it.
const doc = (row, href) => ({ id: row.id, number: row.number, status: row.status ?? null, date: day(row.date), amount: row.amount ?? null,
  currency: row.currency?.trim?.() ?? row.currency ?? null, detail: row.detail ?? null, href });

async function rows(client, sql, values) {
  return (await client.query(sql, values)).rows;
}

const PERMISSIONS = {
  purchaseOrders: ["procurement.po.view", "procurement.po.view_all"],
  bills: ["procurement.bills.view", "accounting.payables.manage"],
  returns: ["procurement.returns.view", "procurement.po.view", "procurement.po.view_all"],
  claims: ["procurement.claims.view", "procurement.claims.manage"],
  credits: ["procurement.credits.manage", "procurement.bills.view", "accounting.payables.manage"],
  sales: ["sales.view"],
  leads: ["crm.leads.view", "crm.leads.view_all"],
  accounts: ["crm.accounts.view", "crm.accounts.view_all"],
  contacts: ["crm.contacts.view", "crm.contacts.view_all"],
  opportunities: ["crm.opportunities.view", "crm.opportunities.view_all"],
  transfers: ["stock.transfers.view"],
  holds: ["stock.holds.view"],
};

async function purchaseOrderGroups(client, c, id) {
  await getPurchaseOrder(client, c, id);
  const org = c.organizationId;
  const groups = [];
  const order = (await rows(client, `SELECT purchase_order_number, source_quotation_id FROM tenant.purchase_orders WHERE organization_id = $1 AND id = $2`, [org, id]))[0];
  const sourceQuotationId = order?.source_quotation_id;
  if (sourceQuotationId && can(c, ...PERMISSIONS.purchaseOrders))
    groups.push({ key: "supplier_quotation", label: "Supplier quotation", direction: "upstream", documents: (await rows(client,
      `SELECT id, quotation_number AS number, status, quotation_date AS date FROM tenant.supplier_quotations WHERE organization_id = $1 AND id = $2`, [org, sourceQuotationId]))
      .map((row) => doc(row, `/procurement/purchase-orders/quotations/${row.id}`)) });
  if (can(c, ...PERMISSIONS.purchaseOrders))
    groups.push({ key: "goods_receipts", label: "Goods receipts", direction: "downstream", documents: (await rows(client,
      `SELECT id, receipt_number AS number, CASE WHEN reversed_at IS NOT NULL THEN 'reversed' ELSE status END AS status, receipt_date AS date
         FROM tenant.goods_receipts WHERE organization_id = $1 AND purchase_order_id = $2 ORDER BY receipt_date DESC, receipt_number DESC LIMIT ${LIMIT}`, [org, id]))
      .map((row) => doc(row, `/procurement/goods-receipts/${row.id}`)) });
  if (can(c, ...PERMISSIONS.bills))
    groups.push({ key: "supplier_bills", label: "Supplier bills", direction: "downstream", documents: (await rows(client,
      `SELECT id, bill_number AS number, status, bill_date AS date, grand_total::text AS amount, currency_code AS currency, supplier_invoice_number AS detail
         FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND source_purchase_order_id = $2 AND bill_type = 'bill' ORDER BY bill_date DESC, bill_number DESC LIMIT ${LIMIT}`, [org, id]))
      .map((row) => doc(row, `/procurement/supplier-bills/${row.id}`)) });
  const returns = can(c, ...PERMISSIONS.returns) || can(c, ...PERMISSIONS.claims)
    ? await rows(client, `SELECT id, return_number AS number, document_status AS status, return_date AS date, replacement_purchase_order_id
         FROM tenant.purchase_returns WHERE organization_id = $1 AND purchase_order_id = $2 ORDER BY return_date DESC, return_number DESC LIMIT ${LIMIT}`, [org, id]) : [];
  if (can(c, ...PERMISSIONS.returns))
    groups.push({ key: "purchase_returns", label: "Purchase returns", direction: "downstream", documents: returns.map((row) => doc(row, `/procurement/purchase-returns/${row.id}`)) });
  if (can(c, ...PERMISSIONS.claims))
    groups.push({ key: "debit_notes", label: "Debit notes", direction: "downstream", documents: (returns.length ? await rows(client,
      `SELECT id, claim_number AS number, status, issue_date AS date FROM tenant.supplier_debit_claims WHERE organization_id = $1 AND purchase_return_id = ANY($2::uuid[])
        ORDER BY issue_date DESC NULLS LAST, claim_number DESC LIMIT ${LIMIT}`, [org, returns.map((row) => row.id)]) : [])
      .map((row) => doc(row, `/procurement/debit-notes-credits/claims/${row.id}`)) });
  if (can(c, ...PERMISSIONS.credits))
    groups.push({ key: "vendor_credits", label: "Vendor credits", direction: "downstream", documents: (await rows(client,
      `SELECT credit.id, credit.bill_number AS number, credit.status, credit.bill_date AS date, credit.grand_total::text AS amount, credit.currency_code AS currency
         FROM tenant.accounting_vendor_bills credit
        WHERE credit.organization_id = $1 AND credit.bill_type = 'credit_note'
          AND (credit.source_purchase_order_id = $2
               OR credit.source_bill_id IN (SELECT bill.id FROM tenant.accounting_vendor_bills bill WHERE bill.organization_id = $1 AND bill.source_purchase_order_id = $2)
               OR credit.source_purchase_return_id IN (SELECT ret.id FROM tenant.purchase_returns ret WHERE ret.organization_id = $1 AND ret.purchase_order_id = $2))
        ORDER BY credit.bill_date DESC, credit.bill_number DESC LIMIT ${LIMIT}`, [org, id]))
      .map((row) => doc(row, `/procurement/debit-notes-credits/vendor-credits/${row.id}`)) });
  const replacements = returns.map((row) => row.replacement_purchase_order_id).filter(Boolean);
  if (replacements.length && can(c, ...PERMISSIONS.purchaseOrders))
    groups.push({ key: "replacement_orders", label: "Replacement orders", direction: "downstream", documents: (await rows(client,
      `SELECT id, purchase_order_number AS number, status, order_date AS date, grand_total::text AS amount, currency_code AS currency
         FROM tenant.purchase_orders WHERE organization_id = $1 AND id = ANY($2::uuid[]) ORDER BY order_date DESC`, [org, replacements]))
      .map((row) => doc(row, `/procurement/purchase-orders/${row.id}`)) });
  return { record: { type: "purchase_order", id, number: order?.purchase_order_number ?? null }, groups };
}

// Quotations and orders that came from an opportunity (directly, or through one of its quotations), and their invoices.
async function salesFromOpportunity(client, c, opportunityId) {
  const org = c.organizationId;
  const groups = [];
  if (!can(c, ...PERMISSIONS.sales) || !opportunityId) return groups;
  const quotations = await rows(client,
    `SELECT id, quotation_number AS number, lifecycle_status AS status, quotation_date AS date FROM tenant.sales_quotations
      WHERE organization_id = $1 AND source_opportunity_id = $2 ORDER BY quotation_date DESC NULLS LAST, quotation_number DESC LIMIT ${LIMIT}`, [org, opportunityId]);
  groups.push({ key: "quotations", label: "Quotations", direction: "downstream", documents: quotations.map((row) => doc(row, `/sales/quotations/${row.id}`)) });
  const orders = await rows(client,
    `SELECT so.id, so.sales_order_number AS number, so.lifecycle_status AS status, so.order_date AS date, version.grand_total::text AS amount
       FROM tenant.sales_orders so
       LEFT JOIN tenant.sales_order_versions version ON version.organization_id = so.organization_id AND version.id = so.current_version_id
      WHERE so.organization_id = $1 AND (so.source_opportunity_id = $2 OR so.source_quotation_id = ANY($3::uuid[]))
      ORDER BY so.order_date DESC NULLS LAST, so.sales_order_number DESC LIMIT ${LIMIT}`, [org, opportunityId, quotations.map((row) => row.id)]);
  groups.push({ key: "sales_orders", label: "Sales orders", direction: "downstream", documents: orders.map((row) => doc(row, `/sales/orders/${row.id}`)) });
  groups.push({ key: "invoices", label: "Invoices", direction: "downstream", documents: (orders.length ? await rows(client,
    `SELECT id, invoice_number AS number, status, invoice_date AS date, grand_total::text AS amount, currency_code AS currency FROM tenant.accounting_customer_invoices
      WHERE organization_id = $1 AND invoice_type = 'invoice' AND source_sales_order_id = ANY($2::uuid[]) ORDER BY invoice_date DESC, invoice_number DESC LIMIT ${LIMIT}`,
    [org, orders.map((row) => row.id)]) : []).map((row) => doc(row, `/sales/invoices/${row.id}`)) });
  return groups;
}

async function partyDoc(client, c, partyId) {
  return (await rows(client, `SELECT id, display_name AS number FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`, [c.organizationId, partyId]))
    .map((row) => doc(row, `/crm/accounts/${row.id}`));
}

async function opportunityGroups(client, c, id) {
  await getOpportunity(client, c, id);
  const org = c.organizationId;
  const opportunity = (await rows(client, `SELECT code, lead_id, party_id FROM tenant.crm_opportunities WHERE organization_id = $1 AND id = $2`, [org, id]))[0];
  const groups = [];
  if (opportunity?.lead_id && can(c, ...PERMISSIONS.leads))
    groups.push({ key: "lead", label: "Source lead", direction: "upstream", documents: (await rows(client,
      `SELECT id, code AS number, status, created_at AS date, COALESCE(company_name, full_name) AS detail FROM tenant.crm_leads WHERE organization_id = $1 AND id = $2`,
      [org, opportunity.lead_id])).map((row) => doc(row, `/crm/leads/${row.id}`)) });
  if (opportunity?.party_id && can(c, ...PERMISSIONS.accounts))
    groups.push({ key: "account", label: "Account", direction: "upstream", documents: await partyDoc(client, c, opportunity.party_id) });
  groups.push(...(await salesFromOpportunity(client, c, id)));
  return { record: { type: "opportunity", id, number: opportunity?.code ?? null }, groups };
}

async function leadGroups(client, c, id) {
  await getLead(client, c, id);
  const org = c.organizationId;
  const lead = (await rows(client, `SELECT code, converted_party_id, converted_contact_id, converted_opportunity_id FROM tenant.crm_leads WHERE organization_id = $1 AND id = $2`, [org, id]))[0];
  const groups = [];
  if (lead?.converted_party_id && can(c, ...PERMISSIONS.accounts))
    groups.push({ key: "account", label: "Account", direction: "downstream", documents: await partyDoc(client, c, lead.converted_party_id) });
  if (lead?.converted_contact_id && can(c, ...PERMISSIONS.contacts))
    groups.push({ key: "contact", label: "Contact", direction: "downstream", documents: (await rows(client,
      `SELECT id, COALESCE(NULLIF(display_name, ''), concat_ws(' ', first_name, last_name)) AS number FROM tenant.contacts WHERE organization_id = $1 AND id = $2`,
      [org, lead.converted_contact_id])).map((row) => doc(row, `/crm/contacts/${row.id}`)) });
  if (lead?.converted_opportunity_id && can(c, ...PERMISSIONS.opportunities))
    groups.push({ key: "opportunity", label: "Opportunity", direction: "downstream", documents: (await rows(client,
      `SELECT id, code AS number, status, expected_close_date AS date, amount::text AS amount, currency_code AS currency, name AS detail FROM tenant.crm_opportunities
        WHERE organization_id = $1 AND id = $2`, [org, lead.converted_opportunity_id])).map((row) => doc(row, `/crm/opportunities/${row.id}`)) });
  if (lead?.converted_opportunity_id) groups.push(...(await salesFromOpportunity(client, c, lead.converted_opportunity_id)));
  return { record: { type: "lead", id, number: lead?.code ?? null }, groups };
}

async function itemGroups(client, c, id) {
  const product = await getProduct(client, c, id);
  const org = c.organizationId;
  const groups = [];
  if (can(c, ...PERMISSIONS.sales))
    groups.push({ key: "sales_orders", label: "Open sales orders", direction: "demand", documents: (await rows(client,
      `SELECT so.id, so.sales_order_number AS number, so.lifecycle_status AS status, so.order_date AS date, sum(line.quantity)::text AS detail
         FROM tenant.sales_orders so
         JOIN tenant.sales_order_lines line ON line.organization_id = so.organization_id AND line.sales_order_version_id = so.current_version_id
        WHERE so.organization_id = $1 AND line.item_id = $2 AND so.lifecycle_status IN ('pending_approval', 'approved', 'confirmed', 'on_hold')
          AND so.fulfillment_status NOT IN ('fulfilled', 'cancelled')
        GROUP BY so.id ORDER BY so.order_date DESC NULLS LAST, so.sales_order_number DESC LIMIT ${LIMIT}`, [org, id]))
      .map((row) => doc({ ...row, detail: `Qty ${Number(row.detail)}` }, `/sales/orders/${row.id}`)) });
  if (can(c, ...PERMISSIONS.purchaseOrders))
    // Still to come in: draft orders, and confirmed orders with this item not yet fully received.
    groups.push({ key: "purchase_orders", label: "Open purchase orders", direction: "supply", documents: (await rows(client,
      `SELECT po.id, po.purchase_order_number AS number, po.status, po.order_date AS date,
              sum(CASE WHEN po.status = 'draft' THEN line.ordered_quantity ELSE COALESCE(status.remaining_to_receive, line.ordered_quantity) END)::text AS detail
         FROM tenant.purchase_orders po
         JOIN tenant.purchase_order_lines line ON line.organization_id = po.organization_id AND line.purchase_order_id = po.id
         LEFT JOIN tenant.purchase_order_line_status status ON status.organization_id = line.organization_id AND status.purchase_order_line_id = line.id
        WHERE po.organization_id = $1 AND line.product_id = $2
          AND (po.status = 'draft' OR (po.status = 'confirmed' AND COALESCE(status.remaining_to_receive, line.ordered_quantity) > 0))
        GROUP BY po.id ORDER BY po.order_date DESC, po.purchase_order_number DESC LIMIT ${LIMIT}`, [org, id]))
      .map((row) => doc({ ...row, detail: `To receive ${Number(row.detail)}` }, `/procurement/purchase-orders/${row.id}`)) });
  if (can(c, ...PERMISSIONS.purchaseOrders))
    groups.push({ key: "goods_receipts", label: "Recent goods receipts", direction: "supply", documents: (await rows(client,
      `SELECT receipt.id, receipt.receipt_number AS number, CASE WHEN receipt.reversed_at IS NOT NULL THEN 'reversed' ELSE receipt.status END AS status, receipt.receipt_date AS date,
              sum(line.accepted_quantity)::text AS detail
         FROM tenant.goods_receipts receipt
         JOIN tenant.goods_receipt_lines line ON line.organization_id = receipt.organization_id AND line.goods_receipt_id = receipt.id
        WHERE receipt.organization_id = $1 AND line.product_id = $2 AND receipt.status = 'posted'
        GROUP BY receipt.id ORDER BY receipt.receipt_date DESC, receipt.receipt_number DESC LIMIT 10`, [org, id]))
      .map((row) => doc({ ...row, detail: `Accepted ${Number(row.detail)}` }, `/procurement/goods-receipts/${row.id}`)) });
  if (can(c, ...PERMISSIONS.transfers))
    groups.push({ key: "transfers", label: "Open transfers", direction: "movement", documents: (await rows(client,
      `SELECT transfer.id, transfer.document_number AS number, transfer.status, transfer.transfer_date AS date, sum(line.quantity)::text AS detail
         FROM tenant.inventory_transfers transfer
         JOIN tenant.inventory_transfer_lines line ON line.organization_id = transfer.organization_id AND line.transfer_id = transfer.id
        WHERE transfer.organization_id = $1 AND line.item_id = $2 AND transfer.status IN ('draft', 'confirmed', 'dispatched', 'partially_received')
        GROUP BY transfer.id ORDER BY transfer.transfer_date DESC NULLS LAST, transfer.document_number DESC LIMIT ${LIMIT}`, [org, id]))
      .map((row) => doc({ ...row, detail: `Qty ${Number(row.detail)}` }, `/inventory/transfers/${row.id}`)) });
  if (can(c, ...PERMISSIONS.holds))
    groups.push({ key: "quality_holds", label: "Active quality holds", direction: "control", documents: (await rows(client,
      `SELECT hold.id, hold.document_number AS number, hold.status, hold.created_at AS date, sum(line.unresolved_base_quantity)::text AS detail
         FROM tenant.inventory_stock_holds hold
         JOIN tenant.inventory_stock_hold_lines line ON line.organization_id = hold.organization_id AND line.hold_id = hold.id
        WHERE hold.organization_id = $1 AND line.item_id = $2 AND hold.status IN ('draft', 'active', 'partially_resolved')
        GROUP BY hold.id ORDER BY hold.created_at DESC LIMIT ${LIMIT}`, [org, id]))
      .map((row) => doc({ ...row, detail: `Held ${Number(row.detail)}` }, `/inventory/quality-holds/${row.id}`)) });
  return { record: { type: "item", id, number: product.code ?? product.sku ?? null }, groups };
}

export async function getRelatedDocuments(client, context, type, id) {
  if (!RELATED_DOCUMENT_TYPES.includes(type)) throw new RelatedDocumentsError(404, "Unknown record type.", "RELATED_TYPE_NOT_FOUND");
  if (!UUID.test(String(id ?? ""))) throw new RelatedDocumentsError(404, "Record not found.", "RELATED_RECORD_NOT_FOUND");
  const load = { purchase_order: purchaseOrderGroups, opportunity: opportunityGroups, lead: leadGroups, item: itemGroups }[type];
  return load(client, context, id);
}
