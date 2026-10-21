// Rate contracts (Sales audit, should-have): a customer's agreed rates for products over a period, with the quantity it may draw — a
// blanket order. While a contract is active and the document's date falls in it, a line for a contracted product is priced at the
// contract's rate (per base unit, ahead of the price list and pricing rules) as long as quantity remains, and keeps the contract line it
// drew from; confirming an order never draws more than was contracted. Orders are the call-offs.
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { SalesError } from "./index.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const can = (c, permission) => Boolean(c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(permission));
const need = (c, permission, message) => { if (!can(c, permission)) throw new SalesError(403, message, "PERMISSION_DENIED"); };
const invalid = (field, message) => new SalesError(400, message, "SALES_RATE_CONTRACT_INVALID", { issues: [{ field, message }] });
const text = (value, max = 500) => String(value ?? "").trim().slice(0, max) || null;
const day = (value) => (value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
  : value ? String(value).slice(0, 10) : null);
const VIEW = "sales.order.view";
const MANAGE = "sales.price_lists.manage_prices";

// What a contract line has drawn: the base quantity of confirmed orders' lines priced from it, less what was cancelled on them.
export const DRAWN_SQL = (lineAlias) => `COALESCE((SELECT sum(order_line.base_quantity * GREATEST(order_line.quantity - progress.cancelled_quantity, 0) / NULLIF(order_line.quantity, 0))
    FROM tenant.sales_order_lines order_line
    JOIN tenant.sales_orders sales_order ON sales_order.current_version_id = order_line.sales_order_version_id AND sales_order.lifecycle_status IN ('confirmed', 'closed')
    JOIN tenant.sales_order_line_progress progress ON progress.sales_order_line_id = order_line.id
   WHERE order_line.rate_contract_line_id = ${lineAlias}.id), 0)`;

function toContract(row, lines = null) {
  return {
    id: row.id, contractNumber: row.contract_number, partyId: row.party_id, customerName: row.customer_name ?? null, name: row.name, customerReference: row.customer_reference,
    currencyCode: String(row.currency_code).trim(), validFrom: day(row.valid_from), validTo: day(row.valid_to), status: row.status,
    statusLabel: { draft: "Draft", active: "Active", closed: "Closed", cancelled: "Cancelled" }[row.status], notes: row.notes,
    ...(lines ? { lines: lines.map((line) => {
      const contracted = Number(line.contracted_quantity);
      const drawn = Number(line.drawn ?? 0);
      return { id: line.id, sequence: line.sequence, itemId: line.item_id, itemName: line.item_name, itemCode: line.item_code, unit: line.uom_code, rate: Number(line.rate),
        contractedQuantity: contracted, drawnQuantity: Math.round(drawn * 1000) / 1000, remainingQuantity: Math.max(0, Math.round((contracted - drawn) * 1000) / 1000) };
    }) } : {}),
  };
}

const SELECT = `SELECT contract.*, party.display_name AS customer_name FROM tenant.sales_rate_contracts contract
  JOIN tenant.business_parties party ON party.id = contract.party_id`;

export async function listRateContracts(client, c, filters = {}) {
  need(c, VIEW, "You do not have permission to view rate contracts.");
  const values = [c.organizationId];
  const where = ["contract.organization_id = $1"];
  if (["draft", "active", "closed", "cancelled"].includes(filters.status)) { values.push(filters.status); where.push(`contract.status = $${values.length}`); }
  if (UUID.test(String(filters.partyId ?? ""))) { values.push(filters.partyId); where.push(`contract.party_id = $${values.length}`); }
  const rows = (await client.query(`${SELECT} WHERE ${where.join(" AND ")} ORDER BY contract.valid_to DESC, contract.contract_number DESC LIMIT 500`, values)).rows;
  return { contracts: rows.map((row) => toContract(row)), canManage: can(c, MANAGE) };
}

export async function getRateContract(client, c, contractId) {
  need(c, VIEW, "You do not have permission to view rate contracts.");
  if (!UUID.test(String(contractId ?? ""))) throw new SalesError(404, "Rate contract not found.", "SALES_RATE_CONTRACT_NOT_FOUND");
  const row = (await client.query(`${SELECT} WHERE contract.organization_id = $1 AND contract.id = $2`, [c.organizationId, contractId])).rows[0];
  if (!row) throw new SalesError(404, "Rate contract not found.", "SALES_RATE_CONTRACT_NOT_FOUND");
  const lines = (await client.query(
    `SELECT line.*, item.name AS item_name, item.code AS item_code, uom.code AS uom_code, ${DRAWN_SQL("line")} AS drawn
       FROM tenant.sales_rate_contract_lines line JOIN tenant.items item ON item.id = line.item_id LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id
      WHERE line.organization_id = $1 AND line.contract_id = $2 ORDER BY line.sequence`, [c.organizationId, row.id])).rows;
  return toContract(row, lines);
}

// input: { partyId, name, customerReference?, currencyCode?, validFrom, validTo, notes?, lines: [{ itemId, rate (per base unit), contractedQuantity (base units) }] }
// A draft is changed by saving it again (id); an active contract is fixed (close it and make another).
export async function saveRateContract(client, c, input = {}, contractId = null) {
  need(c, MANAGE, "You do not have permission to make rate contracts.");
  const existing = contractId ? (await client.query("SELECT * FROM tenant.sales_rate_contracts WHERE organization_id = $1 AND id = $2 FOR UPDATE", [c.organizationId, contractId])).rows[0] : null;
  if (contractId && !existing) throw new SalesError(404, "Rate contract not found.", "SALES_RATE_CONTRACT_NOT_FOUND");
  if (existing && existing.status !== "draft") throw new SalesError(409, "Only a draft contract is changed. Close this one and make another.", "SALES_RATE_CONTRACT_NOT_DRAFT");
  const partyId = input.partyId ?? existing?.party_id;
  if (!UUID.test(String(partyId ?? ""))) throw invalid("partyId", "Choose the customer.");
  const party = (await client.query("SELECT id, currency_code FROM tenant.business_parties WHERE organization_id = $1 AND id = $2 AND status = 'active' AND party_type IN ('customer', 'both')",
    [c.organizationId, partyId])).rows[0];
  if (!party) throw invalid("partyId", "Choose an active customer.");
  const name = text(input.name ?? existing?.name, 160);
  if (!name) throw invalid("name", "Name the contract.");
  const validFrom = day(input.validFrom ?? existing?.valid_from);
  const validTo = day(input.validTo ?? existing?.valid_to);
  if (!DATE.test(validFrom ?? "")) throw invalid("validFrom", "Enter when the contract starts.");
  if (!DATE.test(validTo ?? "") || validTo < validFrom) throw invalid("validTo", "Enter when the contract ends (on or after its start).");
  const currency = text(input.currencyCode, 3)?.toUpperCase() ?? existing?.currency_code ?? String(party.currency_code ?? "INR").trim();
  const lines = Array.isArray(input.lines) ? input.lines : null;
  if (!existing && !lines?.length) throw invalid("lines", "Add the products and their rates.");
  const checked = [];
  for (const [index, line] of (lines ?? []).entries()) {
    if (!UUID.test(String(line.itemId ?? ""))) throw invalid(`lines.${index}.itemId`, `Line ${index + 1}: choose the product.`);
    if (!(await client.query("SELECT 1 FROM tenant.items WHERE organization_id = $1 AND id = $2 AND is_sellable", [c.organizationId, line.itemId])).rows[0])
      throw invalid(`lines.${index}.itemId`, `Line ${index + 1}: choose a product that is sold.`);
    if (checked.some((entry) => entry.itemId === line.itemId)) throw invalid(`lines.${index}.itemId`, `Line ${index + 1}: each product once.`);
    const rate = Number(line.rate);
    const quantity = Number(line.contractedQuantity);
    if (!Number.isFinite(rate) || rate < 0) throw invalid(`lines.${index}.rate`, `Line ${index + 1}: enter the agreed rate.`);
    if (!(quantity > 0)) throw invalid(`lines.${index}.contractedQuantity`, `Line ${index + 1}: enter the quantity contracted.`);
    checked.push({ itemId: line.itemId, rate, quantity });
  }
  let id = existing?.id;
  if (existing) {
    await client.query(
      `UPDATE tenant.sales_rate_contracts SET party_id = $3, name = $4, customer_reference = $5, currency_code = $6, valid_from = $7, valid_to = $8, notes = $9, updated_by = $10, updated_at = now()
        WHERE organization_id = $1 AND id = $2`,
      [c.organizationId, id, partyId, name, text(input.customerReference ?? existing.customer_reference, 120), currency, validFrom, validTo, text(input.notes ?? existing.notes, 2000), c.userId ?? null]);
  } else {
    const number = await nextDocumentNumber(client, { organizationId: c.organizationId }, { documentType: "sales_rate_contract" });
    id = (await client.query(
      `INSERT INTO tenant.sales_rate_contracts (organization_id, contract_number, party_id, name, customer_reference, currency_code, valid_from, valid_to, notes, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING id`,
      [c.organizationId, number, partyId, name, text(input.customerReference, 120), currency, validFrom, validTo, text(input.notes, 2000), c.userId ?? null])).rows[0].id;
  }
  if (lines) {
    await client.query("DELETE FROM tenant.sales_rate_contract_lines WHERE organization_id = $1 AND contract_id = $2", [c.organizationId, id]);
    for (const [index, line] of checked.entries())
      await client.query(`INSERT INTO tenant.sales_rate_contract_lines (organization_id, contract_id, sequence, item_id, rate, contracted_quantity) VALUES ($1, $2, $3, $4, $5, $6)`,
        [c.organizationId, id, index + 1, line.itemId, line.rate, line.quantity]);
  }
  return getRateContract(client, c, id);
}

// activate (a draft becomes the customer's contract: one active contract per product and customer at a time), close, cancel (a draft).
export async function setRateContractStatus(client, c, contractId, action) {
  need(c, MANAGE, "You do not have permission to make rate contracts.");
  const contract = await getRateContract(client, c, contractId);
  if (action === "activate") {
    if (contract.status !== "draft") throw new SalesError(409, "Only a draft contract is activated.", "SALES_RATE_CONTRACT_NOT_DRAFT");
    const clash = (await client.query(
      `SELECT other.contract_number, item.name FROM tenant.sales_rate_contracts other
         JOIN tenant.sales_rate_contract_lines other_line ON other_line.contract_id = other.id
         JOIN tenant.sales_rate_contract_lines mine ON mine.contract_id = $2 AND mine.item_id = other_line.item_id
         JOIN tenant.items item ON item.id = mine.item_id
        WHERE other.organization_id = $1 AND other.id <> $2 AND other.party_id = $3 AND other.status = 'active'
          AND daterange(other.valid_from, other.valid_to, '[]') && daterange($4::date, $5::date, '[]') LIMIT 1`,
      [c.organizationId, contract.id, contract.partyId, contract.validFrom, contract.validTo])).rows[0];
    if (clash) throw new SalesError(409, `${clash.name} is already on active contract ${clash.contract_number} for these dates.`, "SALES_RATE_CONTRACT_OVERLAP");
  } else if (action === "close") {
    if (contract.status !== "active") throw new SalesError(409, "Only an active contract is closed.", "SALES_RATE_CONTRACT_NOT_ACTIVE");
  } else if (action === "cancel") {
    if (contract.status !== "draft") throw new SalesError(409, "Only a draft contract is cancelled; close an active one.", "SALES_RATE_CONTRACT_NOT_DRAFT");
  } else throw new SalesError(400, "Choose activate, close or cancel.", "SALES_RATE_CONTRACT_INVALID");
  const status = { activate: "active", close: "closed", cancel: "cancelled" }[action];
  await client.query("UPDATE tenant.sales_rate_contracts SET status = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2",
    [c.organizationId, contract.id, status, c.userId ?? null]);
  return getRateContract(client, c, contract.id);
}

// The contract line a document line is priced from: the customer's active contract for the product on the date, in the currency, with
// enough left for the line's base quantity (and what the document's other lines on it already take). null when none applies.
export async function contractLineFor(client, organizationId, { partyId, itemId, currencyCode, documentDate, baseQuantity, alreadyTaken = 0, exceptOrderId = null }) {
  const row = (await client.query(
    `SELECT line.id, line.rate, line.contracted_quantity, contract.contract_number,
            COALESCE((SELECT sum(order_line.base_quantity * GREATEST(order_line.quantity - progress.cancelled_quantity, 0) / NULLIF(order_line.quantity, 0))
               FROM tenant.sales_order_lines order_line
               JOIN tenant.sales_orders sales_order ON sales_order.current_version_id = order_line.sales_order_version_id AND sales_order.lifecycle_status IN ('confirmed', 'closed')
               JOIN tenant.sales_order_line_progress progress ON progress.sales_order_line_id = order_line.id
              WHERE order_line.rate_contract_line_id = line.id AND ($6::uuid IS NULL OR sales_order.id <> $6)), 0) AS drawn
       FROM tenant.sales_rate_contract_lines line
       JOIN tenant.sales_rate_contracts contract ON contract.id = line.contract_id
      WHERE line.organization_id = $1 AND contract.party_id = $2 AND line.item_id = $3 AND contract.status = 'active' AND btrim(contract.currency_code) = $4
        AND $5::date BETWEEN contract.valid_from AND contract.valid_to
      LIMIT 1`, [organizationId, partyId, itemId, currencyCode, documentDate, exceptOrderId])).rows[0];
  if (!row) return null;
  const remaining = Number(row.contracted_quantity) - Number(row.drawn) - Number(alreadyTaken);
  return { id: row.id, rate: Number(row.rate), contractNumber: row.contract_number, remaining, enough: remaining + 1e-9 >= Number(baseQuantity) };
}
