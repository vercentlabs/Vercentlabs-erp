// Landed cost on received stock (Procurement plan Phase 3): a cost that arrived after the goods (freight, loading, insurance on a supplier's
// bill) is added to what a goods receipt's stock is worth. The part of the receipt still in stock carries it — a valuation restatement of the
// receipt's movement (moving average: the stream's value and rate; FIFO: the receipt's open layers) and a journal from the charge's account to
// Inventory. The part already issued stays where the bill booked it (the charge's expense account). Nothing here changes a quantity.
import { createJournalEntry, getAccountMapping, getPrimaryLedger, postJournalEntry } from "../accounting/index.js";
import { StockError } from "./errors.js";

const SCALE = 1_000_000n;
const D = (value) => {
  const text = String(value ?? "0").trim();
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const scaled = BigInt(whole || "0") * SCALE + BigInt(`${fraction}000000`.slice(0, 6));
  return negative ? -scaled : scaled;
};
const T = (value, places = 6) => {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const unit = 10n ** BigInt(6 - places);
  const rounded = (absolute + unit / 2n) / unit;
  const digits = rounded.toString().padStart(places + 1, "0");
  const text = places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits;
  return negative && rounded !== 0n ? `-${text}` : text;
};
const money = (value) => D(T(value, 2));
const share = (amount, part, whole) => (whole === 0n ? 0n : (amount * part) / whole);

// restateReceiptCost(sourceLineId, { amount, creditAccountId, description, reference }): the receipt movements of one goods receipt line take
// `amount` (base currency) more value, in proportion to their quantity. Returns { stockAmount, issuedAmount, journalEntryId }.
export async function restateReceiptCost(client, c, sourceLineId, { amount, creditAccountId, description, reference }) {
  const organizationId = c.organizationId;
  const total = money(D(amount));
  if (total <= 0n) return { stockAmount: "0.00", issuedAmount: "0.00", journalEntryId: null };
  const entries = (await client.query(
    `SELECT entry.*, movement.movement_number FROM tenant.inventory_valuation_entries entry
       JOIN tenant.stock_movements movement ON movement.organization_id = entry.organization_id AND movement.id = entry.movement_id
      WHERE entry.organization_id = $1 AND entry.entry_kind = 'movement' AND entry.cost_role = 'inbound' AND movement.source_line_id = $2 AND movement.quantity > 0
        AND NOT EXISTS (SELECT 1 FROM tenant.stock_movements reversal WHERE reversal.organization_id = movement.organization_id AND reversal.reversed_movement_id = movement.id)
      ORDER BY entry.effective_at`, [organizationId, sourceLineId])).rows;
  if (!entries.length) throw new StockError(409, "The goods receipt line put nothing into stock, so it has no value to add a cost to.", "LANDED_COST_NO_STOCK");
  const received = entries.reduce((sum, entry) => sum + D(entry.base_quantity_delta), 0n);
  let stockAmount = 0n;
  let allocated = 0n;
  const restatements = [];
  for (const [index, entry] of entries.entries()) {
    const part = index === entries.length - 1 ? total - allocated : money(share(total, D(entry.base_quantity_delta), received));
    allocated += part;
    const stream = (await client.query(`SELECT * FROM tenant.inventory_valuation_balances WHERE organization_id = $1 AND warehouse_id = $2 AND item_id = $3 FOR UPDATE`,
      [organizationId, entry.warehouse_id, entry.item_id])).rows[0];
    const quantity = D(stream.base_quantity);
    let onHand;
    if (entry.valuation_method === "fifo") {
      // What is left of the receipt's own layers.
      const layers = (await client.query(`SELECT * FROM tenant.inventory_cost_layers WHERE organization_id = $1 AND source_entry_id = $2 AND status = 'open' FOR UPDATE`,
        [organizationId, entry.id])).rows;
      const remaining = layers.reduce((sum, layer) => sum + D(layer.remaining_quantity), 0n);
      onHand = remaining;
      const layerTotal = money(share(part, remaining, D(entry.base_quantity_delta)));
      let spread = 0n;
      for (const [position, layer] of layers.entries()) {
        const add = position === layers.length - 1 ? layerTotal - spread : money(share(layerTotal, D(layer.remaining_quantity), remaining));
        spread += add;
        const remainingValue = D(layer.remaining_value) + add;
        await client.query(`UPDATE tenant.inventory_cost_layers SET remaining_value = $3, unit_cost = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
          [organizationId, layer.id, T(remainingValue, 2), T(D(layer.remaining_quantity) > 0n ? (remainingValue * SCALE) / D(layer.remaining_quantity) : D(layer.unit_cost))]);
      }
    } else {
      // Moving average: the receipt's quantity still in the stream, at most what the stream holds.
      onHand = quantity < D(entry.base_quantity_delta) ? (quantity > 0n ? quantity : 0n) : D(entry.base_quantity_delta);
    }
    const toStock = money(share(part, onHand, D(entry.base_quantity_delta)));
    if (toStock === 0n) continue;
    stockAmount += toStock;
    const value = D(stream.inventory_value) + toStock;
    const restatement = (await client.query(
      `INSERT INTO tenant.inventory_valuation_entries (organization_id, warehouse_id, item_id, entry_kind, cost_role, valuation_method, ledger_type, base_quantity_delta, base_unit_cost,
         value_delta, base_currency, source_cost_type, effective_at, restates_entry_id, balance_quantity_after, balance_value_after, details, created_by)
       VALUES ($1, $2, $3, 'restatement', 'adjustment', $4, $5, 0, 0, $6, $7, 'landed_cost', now(), $8, $9, $10, $11, $12) RETURNING *`,
      [organizationId, entry.warehouse_id, entry.item_id, entry.valuation_method, entry.ledger_type, T(toStock, 2), entry.base_currency, entry.id, stream.base_quantity, T(value, 2),
        JSON.stringify({ landedCost: true, reference: reference ?? null, receivedQuantity: T(D(entry.base_quantity_delta)), onHandQuantity: T(onHand), amount: T(part, 2) }), c.userId ?? null])).rows[0];
    restatements.push(restatement);
    const average = quantity > 0n ? (value * SCALE) / quantity : null;
    await client.query(
      `UPDATE tenant.inventory_valuation_balances SET inventory_value = $3, moving_average_cost = COALESCE($4, moving_average_cost), last_valuation_entry_id = $5, version = version + 1, updated_at = now()
        WHERE organization_id = $1 AND id = $2`, [organizationId, stream.id, T(value, 2), average === null ? null : T(average), restatement.id]);
    if (average !== null)
      await client.query(`UPDATE tenant.stock_balances SET average_cost = $4 WHERE organization_id = $1 AND warehouse_id = $2 AND item_id = $3`,
        [organizationId, entry.warehouse_id, entry.item_id, T(average)]);
  }
  let journalEntryId = null;
  if (stockAmount > 0n) {
    const ctx = { ...c, permissions: [...new Set([...(c.permissions ?? []), "accounting.view", "accounting.journal.create"])] };
    const date = (await client.query(`SELECT (now() AT TIME ZONE COALESCE(NULLIF(timezone, ''), 'Asia/Kolkata'))::date::text AS d FROM public.organizations WHERE id = $1`, [organizationId])).rows[0].d;
    const ledger = await getPrimaryLedger(client, ctx);
    const inventory = (await getAccountMapping(client, ctx, ledger.id, "inventory", { itemId: entries[0].item_id, date })).account_id;
    const journal = (await client.query(`SELECT id FROM tenant.accounting_journals WHERE organization_id = $1 AND ledger_id = $2 AND journal_type = 'general' AND status = 'active' ORDER BY code LIMIT 1`,
      [organizationId, ledger.id])).rows[0];
    if (!journal) throw new StockError(409, "Finance: a General journal is not configured for landed costs.", "LANDED_COST_FINANCE_FAILED");
    const currency = (await client.query(`SELECT base_currency FROM public.organizations WHERE id = $1`, [organizationId])).rows[0]?.base_currency?.trim() || "INR";
    const lines = [
      { accountId: inventory, description, debit: T(stockAmount, 2), credit: 0, referenceType: "inventory_valuation", referenceId: restatements[0].id },
      { accountId: creditAccountId, description, debit: 0, credit: T(stockAmount, 2), referenceType: "inventory_valuation", referenceId: restatements[0].id },
    ];
    const created = await createJournalEntry(client, ctx, { ledgerId: ledger.id, journalId: journal.id, entryDate: date, accountingDate: date, documentDate: date, entryType: "subledger",
      reference: reference ?? "Landed cost", description, currencyCode: currency, exchangeRate: "1", lines },
    { internal: true, sourceModule: "inventory", sourceType: "inventory_valuation", sourceId: restatements[0].id, sourceNumber: reference ?? "Landed cost" });
    await postJournalEntry(client, ctx, created.entry.id, { internal: true, allowDraft: true });
    for (const row of restatements)
      await client.query(`UPDATE tenant.inventory_valuation_entries SET journal_entry_id = $3 WHERE organization_id = $1 AND id = $2`, [organizationId, row.id, created.entry.id]);
    journalEntryId = created.entry.id;
  }
  return { stockAmount: T(stockAmount, 2), issuedAmount: T(total - stockAmount, 2), journalEntryId };
}
