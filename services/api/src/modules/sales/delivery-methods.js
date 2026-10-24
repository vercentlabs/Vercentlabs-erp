// Delivery methods and shipping cost rules (Sales report Phase 3). A method costs a fixed amount, an amount per kg of the goods' gross
// weight, or a percentage of their value; it can be free above an order value, have a minimum, and serve only some states. A quotation or
// order that names a method gets its freight charge worked out from it — it replaces any typed freight — so the price list, the weight
// and the ship-to state decide it, not memory. Setting methods up needs the Sales settings permission.
import { SalesError } from "./index.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const can = (context, permission) => Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission));
const invalid = (message, field) => new SalesError(400, message, "SALES_DELIVERY_METHOD_INVALID", { field });
const money = (value) => (value === null || value === undefined || value === "" ? null : Math.round(Number(value) * 100) / 100);
const BASIS = { fixed: "Fixed amount", per_kg: "Per kg", percent: "% of the value" };

const view = (row) => ({
  id: row.id, name: row.name, basis: row.basis, basisLabel: BASIS[row.basis], rate: Number(row.rate), minimumCharge: row.minimum_charge === null ? null : Number(row.minimum_charge),
  freeAbove: row.free_above === null ? null : Number(row.free_above), stateCodes: row.state_codes ?? [], active: row.status === "active",
});

export async function listDeliveryMethods(client, context, options = {}) {
  const rows = (await client.query(`SELECT * FROM tenant.sales_delivery_methods WHERE organization_id = $1 AND ($2 OR status = 'active') ORDER BY status, lower(name)`,
    [context.organizationId, options.includeInactive === true])).rows;
  return { methods: rows.map(view) };
}

function readMethod(input) {
  const name = String(input.name ?? "").trim().slice(0, 120);
  if (!name) throw invalid("Name the delivery method.", "name");
  if (!BASIS[input.basis]) throw invalid("Choose how it is charged.", "basis");
  const rate = Number(input.rate);
  if (!Number.isFinite(rate) || rate < 0) throw invalid("Enter the rate.", "rate");
  if (input.basis === "percent" && rate > 100) throw invalid("Enter a percentage up to 100.", "rate");
  const states = [...new Set((Array.isArray(input.stateCodes) ? input.stateCodes : []).map((code) => String(code).trim()).filter((code) => /^\d{2}$/.test(code)))];
  return { name, basis: input.basis, rate, minimumCharge: money(input.minimumCharge), freeAbove: money(input.freeAbove), states };
}

export async function saveDeliveryMethod(client, context, input = {}, methodId = null) {
  if (!can(context, "sales.settings.manage")) throw new SalesError(403, "You do not have permission to set up delivery methods.", "PERMISSION_DENIED");
  const values = readMethod(input);
  const params = [values.name, values.basis, values.rate, values.minimumCharge, values.freeAbove, values.states];
  const row = methodId
    ? (await client.query(`UPDATE tenant.sales_delivery_methods SET name = $3, basis = $4, rate = $5, minimum_charge = $6, free_above = $7, state_codes = $8, updated_at = now()
        WHERE organization_id = $1 AND id = $2 RETURNING *`, [context.organizationId, UUID.test(String(methodId)) ? methodId : null, ...params])).rows[0]
    : (await client.query(`INSERT INTO tenant.sales_delivery_methods (organization_id, name, basis, rate, minimum_charge, free_above, state_codes, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`, [context.organizationId, ...params, context.userId ?? null])).rows[0];
  if (!row) throw new SalesError(404, "Delivery method not found.", "SALES_DELIVERY_METHOD_NOT_FOUND");
  return { method: view(row) };
}

export async function setDeliveryMethodActive(client, context, methodId, active) {
  if (!can(context, "sales.settings.manage")) throw new SalesError(403, "You do not have permission to set up delivery methods.", "PERMISSION_DENIED");
  const row = (await client.query("UPDATE tenant.sales_delivery_methods SET status = $3, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING *",
    [context.organizationId, UUID.test(String(methodId ?? "")) ? methodId : null, active ? "active" : "inactive"])).rows[0];
  if (!row) throw new SalesError(404, "Delivery method not found.", "SALES_DELIVERY_METHOD_NOT_FOUND");
  return { method: view(row) };
}

// The freight a document's lines cost by its method: { charge, method } or null. lines are the priced lines (itemId, baseQuantity);
// value is the goods' value after the document discount; stateCode the ship-to (else the place of supply). Refuses a state it does not serve.
export async function deliveryMethodCharge(client, context, methodId, { lines, value, stateCode }) {
  if (!methodId) return null;
  if (!UUID.test(String(methodId))) throw invalid("Choose the delivery method.", "deliveryMethodId");
  const method = (await client.query("SELECT * FROM tenant.sales_delivery_methods WHERE organization_id = $1 AND id = $2", [context.organizationId, methodId])).rows[0];
  if (!method) throw invalid("Choose the delivery method.", "deliveryMethodId");
  if (method.state_codes?.length && stateCode && !method.state_codes.includes(stateCode))
    throw new SalesError(409, `${method.name} does not deliver to this state. Choose another delivery method.`, "SALES_DELIVERY_METHOD_STATE");
  if (method.free_above !== null && Number(value) >= Number(method.free_above)) return { charge: 0, method: view(method) };
  let amount = 0;
  if (method.basis === "fixed") amount = Number(method.rate);
  else if (method.basis === "percent") amount = (Number(value) * Number(method.rate)) / 100;
  else {
    const ids = [...new Set(lines.map((line) => line.itemId).filter(Boolean))];
    const weights = new Map((await client.query(
      `SELECT item.id, item.gross_weight, unit.code FROM tenant.items item LEFT JOIN tenant.units_of_measure unit ON unit.id = item.weight_uom_id
        WHERE item.organization_id = $1 AND item.id = ANY($2::uuid[])`, [context.organizationId, ids])).rows
      .map((row) => [row.id, Number(row.gross_weight ?? 0) * (/^g$|^gm$|^gram/i.test(String(row.code ?? "")) ? 0.001 : /^t$|^ton/i.test(String(row.code ?? "")) ? 1000 : 1)]));
    const kg = lines.reduce((total, line) => total + (weights.get(line.itemId) ?? 0) * Number(line.baseQuantity ?? line.quantity ?? 0), 0);
    amount = kg * Number(method.rate);
  }
  if (method.minimum_charge !== null) amount = Math.max(amount, Number(method.minimum_charge));
  return { charge: Math.round(amount * 100) / 100, method: view(method) };
}
