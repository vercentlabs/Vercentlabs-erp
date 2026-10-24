// Delivery challans without Stock (Sales audit, should-have). A company that does not run inventory still moves goods: ahead of the tax
// invoice, on approval, for job work, to a branch or an exhibition. A challan lists the goods with their value and HSN, the consignee and
// the vehicle; it is printed in three copies and can carry an e-way bill. It moves no stock and posts nothing to the books.
// (With the Stock app, a delivery is the dispatch document and prints its own challan.)
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { SalesError } from "./index.js";
import { companyToday } from "./today.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CHALLAN_PURPOSES = Object.freeze([
  { code: "sale_dispatch", label: "Supply — tax invoice to follow" }, { code: "supply_on_approval", label: "Supply on approval" },
  { code: "job_work", label: "Job work" }, { code: "branch_transfer", label: "Branch transfer / own use" }, { code: "exhibition", label: "Exhibition or fair" },
  { code: "other", label: "Other" },
]);
const PERMISSIONS = Object.freeze({ view: "sales.order.view", manage: "sales.delivery.dispatch" });
const can = (c, permission) => Boolean(c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(permission));
const need = (c, permission, message) => { if (!can(c, permission)) throw new SalesError(403, message, "PERMISSION_DENIED"); };
const invalid = (field, message) => new SalesError(400, message, "SALES_CHALLAN_INVALID", { issues: [{ field, message }] });
const text = (value, max = 500) => String(value ?? "").trim().slice(0, max) || null;
const round = (value, places = 2) => Math.round(Number(value) * 10 ** places) / 10 ** places;
const day = (value) => (value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
  : value ? String(value).slice(0, 10) : null);

function toChallan(row, lines = null) {
  return {
    id: row.id, challanNumber: row.challan_number, challanDate: day(row.challan_date), purpose: row.purpose,
    purposeLabel: CHALLAN_PURPOSES.find((purpose) => purpose.code === row.purpose)?.label ?? row.purpose,
    partyId: row.party_id, customer: row.customer_snapshot ?? {}, shipTo: row.ship_to_snapshot ?? {}, salesOrderId: row.sales_order_id, salesOrderNumber: row.sales_order_number ?? null,
    vehicleNumber: row.vehicle_number, transporterName: row.transporter_name, lrNumber: row.lr_number, notes: row.notes, totalValue: Number(row.total_value),
    status: row.status, statusLabel: { draft: "Draft", issued: "Issued", cancelled: "Cancelled" }[row.status], issuedAt: row.issued_at, cancelReason: row.cancel_reason,
    ...(lines ? { lines: lines.map((line) => ({ id: line.id, sequence: line.sequence, itemId: line.item_id, salesOrderLineId: line.sales_order_line_id, description: line.description,
      hsnSacCode: line.hsn_sac_code, quantity: Number(line.quantity), unit: line.uom_snapshot, unitValue: Number(line.unit_value), taxRate: Number(line.tax_rate), value: Number(line.value) })) } : {}),
  };
}

const SELECT = `SELECT challan.*, sales_order.sales_order_number FROM tenant.sales_challans challan
  LEFT JOIN tenant.sales_orders sales_order ON sales_order.id = challan.sales_order_id`;

// filters: { status, search }
export async function listSalesChallans(client, c, filters = {}) {
  need(c, PERMISSIONS.view, "You do not have permission to view challans.");
  const values = [c.organizationId];
  const where = ["challan.organization_id = $1"];
  if (["draft", "issued", "cancelled"].includes(filters.status)) { values.push(filters.status); where.push(`challan.status = $${values.length}`); }
  const search = String(filters.search ?? "").trim().toLowerCase();
  if (search) { values.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`); where.push(`lower(concat_ws(' ', challan.challan_number, challan.customer_snapshot->>'displayName', sales_order.sales_order_number)) LIKE $${values.length}`); }
  const rows = (await client.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY challan.challan_date DESC, challan.challan_number DESC LIMIT 500`, values)).rows;
  return { challans: rows.map((row) => toChallan(row)), purposes: CHALLAN_PURPOSES, canManage: can(c, PERMISSIONS.manage) };
}

export async function getSalesChallan(client, c, challanId) {
  need(c, PERMISSIONS.view, "You do not have permission to view challans.");
  if (!UUID.test(String(challanId ?? ""))) throw new SalesError(404, "Challan not found.", "SALES_CHALLAN_NOT_FOUND");
  const row = (await client.query(`${SELECT} WHERE challan.organization_id = $1 AND challan.id = $2`, [c.organizationId, challanId])).rows[0];
  if (!row) throw new SalesError(404, "Challan not found.", "SALES_CHALLAN_NOT_FOUND");
  const lines = (await client.query("SELECT * FROM tenant.sales_challan_lines WHERE organization_id = $1 AND challan_id = $2 ORDER BY sequence", [c.organizationId, row.id])).rows;
  return toChallan(row, lines);
}

// The lines of an order still to dispatch, at their order value, to start a challan from.
async function orderLines(client, c, orderId) {
  return (await client.query(
    `SELECT line.id, line.item_id, COALESCE(line.description_snapshot, line.item_name_snapshot) AS description, line.hsn_sac_snapshot, line.uom_snapshot, line.tax_rate,
            GREATEST(line.quantity - progress.cancelled_quantity - COALESCE((SELECT sum(challan_line.quantity) FROM tenant.sales_challan_lines challan_line
               JOIN tenant.sales_challans challan ON challan.id = challan_line.challan_id AND challan.status = 'issued' WHERE challan_line.sales_order_line_id = line.id), 0), 0) AS remaining,
            CASE WHEN line.quantity > 0 THEN line.taxable_amount / line.quantity ELSE 0 END AS unit_value
       FROM tenant.sales_orders sales_order
       JOIN tenant.sales_order_lines line ON line.sales_order_version_id = sales_order.current_version_id
       JOIN tenant.items item ON item.id = line.item_id AND item.item_type <> 'service'
       JOIN tenant.sales_order_line_progress progress ON progress.sales_order_line_id = line.id
      WHERE sales_order.organization_id = $1 AND sales_order.id = $2 AND sales_order.lifecycle_status IN ('confirmed', 'closed') ORDER BY line.sequence`,
    [c.organizationId, orderId])).rows;
}

// input: { purpose, partyId?, salesOrderId? (lines default to what it still has to dispatch), challanDate?, shippingAddressId?,
//          lines? [{ itemId?, salesOrderLineId?, description?, quantity, unitValue?, hsnSacCode? }], vehicleNumber?, transporterName?, lrNumber?, notes? }
export async function createSalesChallan(client, c, input = {}) {
  need(c, PERMISSIONS.manage, "You do not have permission to make challans.");
  const purpose = String(input.purpose ?? (input.salesOrderId ? "sale_dispatch" : ""));
  if (!CHALLAN_PURPOSES.some((entry) => entry.code === purpose)) throw invalid("purpose", "Choose why the goods are moving.");
  let partyId = input.partyId || null;
  let order = null;
  if (input.salesOrderId) {
    if (!UUID.test(String(input.salesOrderId))) throw invalid("salesOrderId", "Choose the sales order.");
    order = (await client.query(
      `SELECT sales_order.id, sales_order.party_id, version.customer_snapshot, version.shipping_address_snapshot, version.seller_registration_id
         FROM tenant.sales_orders sales_order JOIN tenant.sales_order_versions version ON version.id = sales_order.current_version_id
        WHERE sales_order.organization_id = $1 AND sales_order.id = $2 AND sales_order.lifecycle_status IN ('confirmed', 'closed')`, [c.organizationId, input.salesOrderId])).rows[0];
    if (!order) throw invalid("salesOrderId", "Choose a confirmed sales order.");
    partyId = order.party_id;
  }
  if (!partyId && purpose !== "branch_transfer") throw invalid("partyId", "Choose who the goods go to.");
  const party = partyId ? (await client.query(
    "SELECT id, display_name, legal_name, gstin, customer_number, code FROM tenant.business_parties WHERE organization_id = $1 AND id = $2 AND status = 'active'",
    [c.organizationId, partyId])).rows[0] : null;
  if (partyId && !party) throw invalid("partyId", "Choose an active customer or party.");
  let shipTo = order?.shipping_address_snapshot ?? {};
  if (input.shippingAddressId) {
    const address = (await client.query(
      `SELECT * FROM tenant.addresses WHERE organization_id = $1 AND id = $2 AND party_id = $3`,
      [c.organizationId, input.shippingAddressId, partyId])).rows[0];
    if (!address) throw invalid("shippingAddressId", "Choose one of the ship-to addresses.");
    shipTo = { label: address.label, line1: address.line1 ?? address.address_line1, line2: address.line2 ?? address.address_line2, city: address.city, state: address.state ?? address.state_name,
      stateCode: address.state_code, postalCode: address.postal_code, countryCode: address.country_code };
  }
  const given = Array.isArray(input.lines) ? input.lines : null;
  const fromOrder = order ? await orderLines(client, c, order.id) : [];
  const source = given ?? fromOrder.filter((line) => Number(line.remaining) > 0).map((line) => ({ salesOrderLineId: line.id, quantity: Number(line.remaining) }));
  if (!source.length) throw invalid("lines", order ? "Everything on this order has already gone out on challans." : "Add the goods being sent.");
  const lines = [];
  for (const [index, entry] of source.entries()) {
    const quantity = Number(entry.quantity);
    if (!(quantity > 0)) throw invalid(`lines.${index}.quantity`, `Line ${index + 1}: enter the quantity.`);
    const ordered = entry.salesOrderLineId ? fromOrder.find((line) => line.id === entry.salesOrderLineId) : null;
    if (entry.salesOrderLineId && !ordered) throw invalid(`lines.${index}`, `Line ${index + 1} is not on the order.`);
    if (ordered && quantity > Number(ordered.remaining) + 1e-9) throw invalid(`lines.${index}.quantity`, `Line ${index + 1}: only ${Number(ordered.remaining)} is still to go out on this order.`);
    let item = null;
    const itemId = entry.itemId || ordered?.item_id || null;
    if (itemId) {
      item = (await client.query(`SELECT item.id, item.name, item.hsn_sac_code, uom.code AS uom_code, item.standard_cost FROM tenant.items item
        LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id WHERE item.organization_id = $1 AND item.id = $2`, [c.organizationId, itemId])).rows[0];
      if (!item) throw invalid(`lines.${index}.itemId`, `Line ${index + 1}: choose a product.`);
    }
    const description = text(entry.description, 500) ?? ordered?.description ?? item?.name;
    if (!description) throw invalid(`lines.${index}.description`, `Line ${index + 1}: describe the goods.`);
    const unitValue = entry.unitValue != null && entry.unitValue !== "" ? Number(entry.unitValue) : Number(ordered?.unit_value ?? item?.standard_cost ?? 0);
    if (!Number.isFinite(unitValue) || unitValue < 0) throw invalid(`lines.${index}.unitValue`, `Line ${index + 1}: enter the value.`);
    lines.push({ itemId, salesOrderLineId: ordered?.id ?? null, description, hsn: text(entry.hsnSacCode, 8) ?? ordered?.hsn_sac_snapshot ?? item?.hsn_sac_code ?? null,
      quantity, unit: ordered?.uom_snapshot ?? item?.uom_code ?? text(entry.unit, 20), unitValue: round(unitValue, 6), taxRate: Number(ordered?.tax_rate ?? 0), value: round(quantity * unitValue) });
  }
  const today = await companyToday(client);
  const challanDate = input.challanDate ? String(input.challanDate).slice(0, 10) : today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(challanDate) || challanDate > today) throw invalid("challanDate", "Enter the challan date (not in the future).");
  const number = await nextDocumentNumber(client, { organizationId: c.organizationId }, { documentType: "sales_challan", at: new Date(`${challanDate}T12:00:00Z`) });
  const customer = party ? { displayName: party.display_name, legalName: party.legal_name, gstin: party.gstin, customerNumber: party.customer_number ?? party.code } : {};
  const total = round(lines.reduce((sum, line) => sum + line.value, 0));
  const row = (await client.query(
    `INSERT INTO tenant.sales_challans (organization_id, challan_number, challan_date, purpose, party_id, sales_order_id, customer_snapshot, ship_to_snapshot, seller_registration_id,
        vehicle_number, transporter_name, lr_number, notes, total_value, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $15) RETURNING id`,
    [c.organizationId, number, challanDate, purpose, partyId, order?.id ?? null, JSON.stringify(customer), JSON.stringify(shipTo), order?.seller_registration_id ?? null,
      text(input.vehicleNumber, 20)?.toUpperCase().replace(/[\s-]/g, "") ?? null, text(input.transporterName, 160), text(input.lrNumber, 60), text(input.notes, 2000), total, c.userId ?? null])).rows[0];
  for (const [index, line] of lines.entries())
    await client.query(
      `INSERT INTO tenant.sales_challan_lines (organization_id, challan_id, sequence, item_id, sales_order_line_id, description, hsn_sac_code, quantity, uom_snapshot, unit_value, tax_rate, value)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [c.organizationId, row.id, index + 1, line.itemId, line.salesOrderLineId, line.description, line.hsn, line.quantity, line.unit, line.unitValue, line.taxRate, line.value]);
  return getSalesChallan(client, c, row.id);
}

// Issue (the goods go out on it) or cancel (with a reason). An issued challan is not changed; cancel it and make another.
export async function setSalesChallanStatus(client, c, challanId, { action, reason } = {}) {
  need(c, PERMISSIONS.manage, "You do not have permission to make challans.");
  const challan = await getSalesChallan(client, c, challanId);
  if (action === "issue") {
    if (challan.status !== "draft") throw new SalesError(409, "Only a draft challan is issued.", "SALES_CHALLAN_NOT_DRAFT");
    await client.query("UPDATE tenant.sales_challans SET status = 'issued', issued_at = now(), issued_by = $3, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2",
      [c.organizationId, challan.id, c.userId ?? null]);
  } else if (action === "cancel") {
    if (challan.status === "cancelled") return challan;
    const why = text(reason, 500);
    if (!why || why.length < 5) throw invalid("reason", "Say why the challan is cancelled (at least 5 characters).");
    const ewb = (await client.query("SELECT 1 FROM tenant.eway_bills WHERE organization_id = $1 AND source_type = 'sales_challan' AND source_id = $2 AND status = 'generated'",
      [c.organizationId, challan.id])).rows[0];
    if (ewb) throw new SalesError(409, "Cancel the challan's e-way bill first.", "SALES_CHALLAN_HAS_EWAY_BILL");
    await client.query("UPDATE tenant.sales_challans SET status = 'cancelled', cancelled_at = now(), cancel_reason = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2",
      [c.organizationId, challan.id, why, c.userId ?? null]);
  } else throw new SalesError(400, "Choose issue or cancel.", "SALES_CHALLAN_INVALID");
  return getSalesChallan(client, c, challan.id);
}
