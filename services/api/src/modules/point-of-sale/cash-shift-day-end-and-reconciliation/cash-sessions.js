// POS Opening Cash Float (0104) — the cash session as a custody record: its drawer, its confirmed opening count (where the cash came from, any
// handover and the difference, approval, notes and coins), corrections recorded beside it (never an edit), and what the drawer should hold now.
// The opening itself is part of opening a shift (shift-opening.js); there is no separate float module, balance or ledger.
//
//   expected cash = opening float + cash received − change given − cash handed back on uncompleted tenders − cash refunds paid
//                   + authorised cash in − authorised cash out          (each physical event recorded once, in pos_cash_movements)
//
// Amounts are sensitive: the cashier sees their own opening count; expected cash, handover amounts, history and corrections need
// SESSION_VIEW_EXPECTED_CASH (or outlet management). Drawers are set up by those who configure terminal cash.
import { POS_TERMINAL_PERMISSIONS } from "@vercentlabs/permissions";

import { decimal, add, sub, asDatabaseDecimal, formatDecimal } from "../../../core/decimal.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess, accessiblePosStoreIds } from "../shared/access-control.js";
import { event } from "../shared/audit.js";
import { authorizePosAction, assertPosAction } from "../permissions/index.js";

const privileged = (c) => Boolean(c.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug)));
const can = (c, permission) => privileged(c) || Boolean(c.permissions?.includes(permission));
const text = (value, max = 500) => { const out = String(value ?? "").trim(); return out ? out.slice(0, max) : null; };
const money = (value) => {
  if (value === null || value === undefined) return null;
  const [whole, fraction = ""] = formatDecimal(decimal(String(value))).split(".");
  return `${whole}.${(fraction + "00").slice(0, 2)}`;
};
const MONEY = /^\d{1,14}(\.\d{1,2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cashError = (status, code, message) => posError(status, message, code);

async function seesExpectedCash(client, context, storeId) {
  if (can(context, "pos.store.manage")) return true;
  try { return (await authorizePosAction(client, context, { permission: "SESSION_VIEW_EXPECTED_CASH", outletId: storeId ?? undefined })).decision === "ALLOW"; } catch { return false; }
}

const CASH_SESSION_SELECT = `
  SELECT cash.*, shift.shift_number, shift.cashier_user_id, shift.lifecycle_status, shift.counted_cash, shift.cash_variance, shift.closed_at AS shift_closed_at,
         store.name AS store_name, terminal.code AS terminal_code, terminal.name AS terminal_name, drawer.code AS drawer_code, drawer.name AS drawer_name,
         confirmer.full_name AS confirmed_by_name, handover.from_session_id AS handover_from_session_id, previous.shift_number AS handover_from_shift_number,
         handover.closing_counted_amount AS handover_closing_counted, handover.removed_amount AS handover_removed, handover.removal_note AS handover_removal_note,
         approval.approver_user_id, approver.full_name AS approver_name
    FROM tenant.pos_cash_sessions cash
    JOIN tenant.pos_shifts shift ON shift.organization_id = cash.organization_id AND shift.id = cash.operating_session_id
    JOIN tenant.pos_stores store ON store.organization_id = cash.organization_id AND store.id = cash.store_id
    JOIN tenant.pos_terminals terminal ON terminal.organization_id = cash.organization_id AND terminal.id = cash.terminal_id
    LEFT JOIN tenant.pos_cash_drawers drawer ON drawer.organization_id = cash.organization_id AND drawer.id = cash.cash_drawer_id
    LEFT JOIN public.users confirmer ON confirmer.id = cash.opening_confirmed_by
    LEFT JOIN tenant.pos_cash_handovers handover ON handover.organization_id = cash.organization_id AND handover.id = cash.handover_id
    LEFT JOIN tenant.pos_shifts previous ON previous.organization_id = cash.organization_id AND previous.id = handover.from_session_id
    LEFT JOIN tenant.pos_permission_approvals approval ON approval.organization_id = cash.organization_id AND approval.id = cash.approval_id
    LEFT JOIN public.users approver ON approver.id = approval.approver_user_id`;

async function loadCashSession(client, context, cashSessionId) {
  requirePermission(context, "pos.view");
  if (!UUID.test(String(cashSessionId ?? ""))) throw cashError(404, "POS_CASH_SESSION_NOT_FOUND", "Cash session not found.");
  const row = (await client.query(`${CASH_SESSION_SELECT} WHERE cash.organization_id = $1 AND cash.id = $2`, [context.organizationId, cashSessionId])).rows[0];
  if (!row) throw cashError(404, "POS_CASH_SESSION_NOT_FOUND", "Cash session not found.");
  const mine = row.cashier_user_id === context.userId;
  if (!mine) {
    try { await assertPosStoreAccess(client, context, row.store_id); } catch { throw cashError(404, "POS_CASH_SESSION_NOT_FOUND", "Cash session not found."); }
  }
  return { row, mine, sensitive: await seesExpectedCash(client, context, row.store_id) };
}

// The confirmed opening count as recorded (never changed): amount, source and reference, notes and coins, the drawer, who confirmed and when
// (server time), and — for those who may see it — the handover it was compared with, the difference, its reason and the approval.
function openingCountOf(row, sensitive, mine) {
  return {
    openingCountId: row.id, cashSessionId: row.id, shiftId: row.operating_session_id, shiftNumber: row.shift_number,
    cashDrawer: row.cash_drawer_id ? { id: row.cash_drawer_id, code: row.drawer_code, name: row.drawer_name } : null, terminalCode: row.terminal_code, storeName: row.store_name,
    currency: (row.currency_code ?? "INR").trim(), openingAmount: money(row.opening_float_amount), sourceType: row.source_type, sourceReference: row.source_reference,
    denominations: row.denomination_details ?? null, confirmedBy: row.confirmed_by_name, confirmedAt: row.opening_confirmed_at, status: "CONFIRMED",
    ...(row.handover_id ? {
      handover: { id: row.handover_id, fromShiftNumber: row.handover_from_shift_number,
        ...(sensitive ? { amount: money(row.handover_amount), closingCounted: money(row.handover_closing_counted), removed: money(row.handover_removed), removalNote: row.handover_removal_note } : {}) },
      variance: sensitive || mine ? money(row.opening_variance_amount) : null, varianceReason: row.variance_reason,
      approval: row.approval_id ? { id: row.approval_id, approver: sensitive ? row.approver_name : undefined } : null,
    } : { handover: null, variance: null, varianceReason: null, approval: null }),
  };
}

// The drawer now: each kind of physical event once, from the cash session's movements (the float is its 'opening' event; cash-in and cash-out
// are only authorised movements). Expected = their sum.
export async function getCashSessionExpectedBalance(client, context, cashSessionId) {
  const { row, sensitive } = await loadCashSession(client, context, cashSessionId);
  if (!sensitive) throw cashError(403, "POS_CASH_EXPECTED_HIDDEN", "You cannot see the expected cash in this drawer.");
  // Shift Closing (0105): a blind closing count comes first — the session's own cashier sees nothing while closing until they have counted.
  if (row.cashier_user_id === context.userId && row.lifecycle_status === "CLOSING" && await blindCountPending(client, context, row)) {
    throw cashError(403, "POS_CASH_EXPECTED_HIDDEN", "Count the drawer first: the expected cash is shown after your count.");
  }
  const { breakdown, expected, events } = await computeExpectedCash(client, context.organizationId, row.operating_session_id, row.opening_float_amount);
  return { cashSessionId: row.id, shiftNumber: row.shift_number, status: row.status, currency: (row.currency_code ?? "INR").trim(), breakdown,
    expectedCash: money(asDatabaseDecimal(expected)), countedAtClose: row.counted_cash === null ? null : money(row.counted_cash),
    closingVariance: row.cash_variance === null ? null : money(row.cash_variance), events };
}

async function blindCountPending(client, context, row) {
  const policy = (await client.query(`SELECT closing_blind_count FROM tenant.pos_settings WHERE organization_id = $1`, [context.organizationId])).rows[0];
  if (policy && policy.closing_blind_count === false) return false;
  return !(await client.query(`SELECT 1 FROM tenant.pos_cash_closing_counts WHERE organization_id = $1 AND cash_session_id = $2 LIMIT 1`, [context.organizationId, row.id])).rows[0];
}

// The expected drawer balance from the cash session's physical events, each once (the float is its 'opening' event; cash-in and cash-out are
// only authorised movements; card / UPI never touch the drawer). Exact decimals. Used by the expected-cash view and by Shift Closing.
export async function computeExpectedCash(client, organizationId, shiftId, openingFloat) {
  const rows = (await client.query(
    `SELECT COALESCE(cash_event, movement_type) AS kind, sum(amount)::text AS total, count(*)::int AS events FROM tenant.pos_cash_movements
      WHERE organization_id = $1 AND shift_id = $2 GROUP BY 1`, [organizationId, shiftId])).rows;
  const of = (...kinds) => rows.filter((entry) => kinds.includes(entry.kind)).reduce((sum, entry) => add(sum, decimal(entry.total)), decimal("0"));
  const expected = rows.reduce((sum, entry) => add(sum, decimal(entry.total)), decimal("0"));
  const out = (value) => money(asDatabaseDecimal(value));
  const breakdown = {
    openingFloat: money(openingFloat ?? "0"),
    cashReceived: out(of("sale_cash_received", "sale_net", "sale")), changeGiven: out(sub(decimal("0"), of("sale_change_given"))),
    uncompletedTendersReturned: out(sub(decimal("0"), of("uncompleted_tender_cash_returned"))), cashRefundsPaid: out(sub(decimal("0"), of("cash_refund_paid", "refund"))),
    cashMovementIn: out(of("cash_movement_in", "paid_in")), cashMovementOut: out(sub(decimal("0"), of("cash_movement_out", "paid_out"))), closingAdjustments: out(of("closing_adjustment")),
  };
  return { breakdown, expected, events: rows.reduce((sum, entry) => sum + entry.events, 0) };
}

// One cash session: its opening count, the corrections beside it, and (for those who may see it) the expected cash now.
export async function getPosCashSession(client, context, cashSessionId) {
  const { row, mine, sensitive } = await loadCashSession(client, context, cashSessionId);
  const corrections = sensitive || mine ? (await client.query(
    `SELECT correction.*, users.full_name AS recorded_by_name FROM tenant.pos_cash_opening_corrections correction LEFT JOIN public.users ON users.id = correction.recorded_by
      WHERE correction.organization_id = $1 AND correction.cash_session_id = $2 ORDER BY correction.recorded_at`, [context.organizationId, row.id])).rows
    .map((entry) => ({ id: entry.id, confirmedAmount: money(entry.confirmed_amount), correctedAmount: money(entry.corrected_amount), difference: money(entry.difference),
      reason: entry.reason, recordedBy: entry.recorded_by_name, recordedAt: entry.recorded_at })) : [];
  return {
    id: row.id, shiftId: row.operating_session_id, shiftNumber: row.shift_number, status: row.status, shiftStatus: row.lifecycle_status, storeName: row.store_name,
    terminalCode: row.terminal_code, terminalName: row.terminal_name, openedAt: row.opened_at, closedAt: row.closed_at,
    openingCount: openingCountOf(row, sensitive, mine), corrections,
    expected: sensitive ? await getCashSessionExpectedBalance(client, context, row.id).catch((error) => { if (error?.code === "POS_CASH_EXPECTED_HIDDEN") return null; throw error; }) : null,
  };
}

export async function getPosCashOpeningCount(client, context, cashSessionId) {
  const { row, mine, sensitive } = await loadCashSession(client, context, cashSessionId);
  return openingCountOf(row, sensitive, mine);
}

// A counting mistake found after opening (the drawer really held ₹1,950, not ₹2,000): a supervisor — never the session's cashier — records the
// corrected count and why, beside the confirmed one. Nothing is edited and no cash movement is invented (a miscount is not money moving); the
// correction explains the difference at closing. input: correctedAmount, reason.
export async function recordPosOpeningCorrection(client, context, cashSessionId, input = {}) {
  const { row } = await loadCashSession(client, context, cashSessionId);
  if (row.cashier_user_id === context.userId) throw cashError(403, "POS_SHIFT_PERMISSION_DENIED", "A supervisor other than the session's cashier records an opening correction.");
  const reason = text(input.reason);
  if (!reason) throw cashError(400, "POS_REASON_REQUIRED", "Say why the opening count is being corrected.");
  try { await assertPosAction(client, context, { permission: "SESSION_CLOSE_OTHER", outletId: row.store_id, reason }); }
  catch { throw cashError(403, "POS_SHIFT_PERMISSION_DENIED", "Only a supervisor can correct an opening count."); }
  const value = String(input.correctedAmount ?? "").trim();
  if (!MONEY.test(value)) throw cashError(400, "POS_SHIFT_CASH_AMOUNT_INVALID", "Enter the corrected opening amount (two decimals at most).");
  const difference = sub(decimal(value), decimal(String(row.opening_float_amount)));
  if (difference === 0n) throw cashError(400, "POS_SHIFT_CASH_AMOUNT_INVALID", "The corrected amount is the confirmed amount: nothing to correct.");
  const correction = (await client.query(
    `INSERT INTO tenant.pos_cash_opening_corrections (organization_id, cash_session_id, confirmed_amount, corrected_amount, difference, reason, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [context.organizationId, row.id, money(row.opening_float_amount), value, asDatabaseDecimal(difference), reason, context.userId])).rows[0];
  await event(client, context, "shift", row.operating_session_id, "pos.cash.opening_corrected",
    { cashSessionId: row.id, confirmed: money(row.opening_float_amount), corrected: money(value), difference: money(asDatabaseDecimal(difference)), reason });
  return { id: correction.id, ...(await getPosCashSession(client, context, row.id)) };
}

// Opening history: every opening count at the outlets the user may see — drawer, cashier, amount, source, handover and difference, approval,
// corrections. Sensitive: SESSION_VIEW_EXPECTED_CASH or outlet management. filters: from, to, storeId, drawerId, sourceType, withVariance, limit, offset.
export async function listPosCashOpeningHistory(client, context, filters = {}) {
  requirePermission(context, "pos.view");
  if (!(await seesExpectedCash(client, context, filters.storeId ?? null))) throw cashError(403, "POS_CASH_EXPECTED_HIDDEN", "You cannot see opening cash history.");
  const stores = await accessiblePosStoreIds(client, context);
  const values = [context.organizationId, stores, filters.from ?? null, filters.to ?? null, filters.storeId ?? null, filters.drawerId ?? null,
    filters.sourceType ? String(filters.sourceType).toUpperCase() : null, filters.withVariance === true || filters.withVariance === "true", Math.min(Number(filters.limit) || 50, 200),
    Number(filters.offset) || 0];
  const { rows } = await client.query(
    `${CASH_SESSION_SELECT}
      WHERE cash.organization_id = $1 AND ($2::uuid[] IS NULL OR cash.store_id = ANY($2::uuid[])) AND ($3::date IS NULL OR cash.opened_at >= $3::date)
        AND ($4::date IS NULL OR cash.opened_at < $4::date + 1) AND ($5::uuid IS NULL OR cash.store_id = $5) AND ($6::uuid IS NULL OR cash.cash_drawer_id = $6)
        AND ($7::text IS NULL OR cash.source_type = $7) AND (NOT $8 OR cash.opening_variance_amount <> 0)
      ORDER BY cash.opened_at DESC LIMIT $9 OFFSET $10`, values);
  const counts = new Map((await client.query(
    `SELECT cash_session_id, count(*)::int AS n FROM tenant.pos_cash_opening_corrections WHERE organization_id = $1 AND cash_session_id = ANY($2::uuid[]) GROUP BY cash_session_id`,
    [context.organizationId, rows.map((row) => row.id)])).rows.map((row) => [row.cash_session_id, row.n]));
  const total = Number((await client.query(
    `SELECT count(*)::int AS n FROM tenant.pos_cash_sessions cash WHERE cash.organization_id = $1 AND ($2::uuid[] IS NULL OR cash.store_id = ANY($2::uuid[]))
        AND ($3::date IS NULL OR cash.opened_at >= $3::date) AND ($4::date IS NULL OR cash.opened_at < $4::date + 1) AND ($5::uuid IS NULL OR cash.store_id = $5)
        AND ($6::uuid IS NULL OR cash.cash_drawer_id = $6) AND ($7::text IS NULL OR cash.source_type = $7) AND (NOT $8 OR cash.opening_variance_amount <> 0)`,
    values.slice(0, 8))).rows[0].n);
  return { total, rows: rows.map((row) => ({ ...openingCountOf(row, true, false), cashier: row.confirmed_by_name, status: row.status, corrections: counts.get(row.id) ?? 0 })) };
}

// The cash waiting in a drawer from its last close (same visibility rules as a counter's handover).
export async function getCashDrawerHandover(client, context, drawerId) {
  requirePermission(context, "pos.view");
  const drawer = (await client.query(`SELECT id, store_id FROM tenant.pos_cash_drawers WHERE organization_id = $1 AND id = $2`, [context.organizationId, drawerId])).rows[0];
  if (!drawer) throw cashError(404, "POS_CASH_DRAWER_NOT_FOUND", "Cash drawer not found.");
  try { await assertPosStoreAccess(client, context, drawer.store_id); } catch { throw cashError(404, "POS_CASH_DRAWER_NOT_FOUND", "Cash drawer not found."); }
  const handover = (await client.query(
    `SELECT handover.*, shift.shift_number AS from_shift_number, users.full_name AS handed_over_by_name FROM tenant.pos_cash_handovers handover
       JOIN tenant.pos_shifts shift ON shift.organization_id = handover.organization_id AND shift.id = handover.from_session_id
       LEFT JOIN public.users ON users.id = handover.handed_over_by
      WHERE handover.organization_id = $1 AND handover.cash_drawer_id = $2 AND handover.status = 'pending'`, [context.organizationId, drawer.id])).rows[0];
  if (!handover) return null;
  const sensitive = await seesExpectedCash(client, context, drawer.store_id);
  return { id: handover.id, cashDrawerId: drawer.id, fromShiftNumber: handover.from_shift_number, handedOverBy: handover.handed_over_by_name, handedOverAt: handover.handed_over_at,
    ...(sensitive ? { amount: money(handover.amount), closingCounted: money(handover.closing_counted_amount), removed: money(handover.removed_amount), removalNote: handover.removal_note } : {}) };
}

// ------------------------------------------------------------------ drawers

// An outlet's drawers: which counters use each, and who holds it now.
export async function listPosCashDrawers(client, context, { storeId = null } = {}) {
  requirePermission(context, "pos.view");
  const stores = await accessiblePosStoreIds(client, context);
  const { rows } = await client.query(
    `SELECT drawer.*, store.name AS store_name,
            (SELECT array_agg(terminal.code ORDER BY terminal.code) FROM tenant.pos_terminals terminal WHERE terminal.organization_id = drawer.organization_id AND terminal.cash_drawer_id = drawer.id) AS terminals,
            holder.shift_number AS held_by_shift, holder_user.full_name AS held_by
       FROM tenant.pos_cash_drawers drawer JOIN tenant.pos_stores store ON store.organization_id = drawer.organization_id AND store.id = drawer.store_id
       LEFT JOIN tenant.pos_cash_sessions cash ON cash.organization_id = drawer.organization_id AND cash.cash_drawer_id = drawer.id AND cash.status IN ('open', 'closing')
       LEFT JOIN tenant.pos_shifts holder ON holder.organization_id = cash.organization_id AND holder.id = cash.operating_session_id
       LEFT JOIN public.users holder_user ON holder_user.id = holder.cashier_user_id
      WHERE drawer.organization_id = $1 AND ($2::uuid[] IS NULL OR drawer.store_id = ANY($2::uuid[])) AND ($3::uuid IS NULL OR drawer.store_id = $3)
      ORDER BY store.name, drawer.code`, [context.organizationId, stores, storeId]);
  return rows.map((row) => ({ id: row.id, storeId: row.store_id, storeName: row.store_name, code: row.code, name: row.name, status: row.status, terminals: row.terminals ?? [],
    heldByShift: row.held_by_shift ?? null, heldBy: row.held_by ?? null }));
}

// Add or change a drawer (configuring terminal cash). A drawer someone holds cannot be made inactive. input: id?, storeId, code, name, status?.
export async function savePosCashDrawer(client, context, input = {}) {
  if (!can(context, POS_TERMINAL_PERMISSIONS.configureCash)) throw cashError(403, "POS_CASH_DRAWER_PERMISSION_DENIED", "You do not have permission to set up cash drawers.");
  const code = String(input.code ?? "").trim().toUpperCase();
  const name = text(input.name, 120);
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,29}$/.test(code) || !name) throw cashError(400, "POS_CASH_DRAWER_INVALID", "Give the drawer a code (letters and numbers) and a name.");
  if (input.id) {
    const current = (await client.query(`SELECT * FROM tenant.pos_cash_drawers WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, input.id])).rows[0];
    if (!current) throw cashError(404, "POS_CASH_DRAWER_NOT_FOUND", "Cash drawer not found.");
    await assertPosStoreAccess(client, context, current.store_id);
    const status = input.status === "inactive" ? "inactive" : "active";
    if (status === "inactive" && (await client.query(`SELECT 1 FROM tenant.pos_cash_sessions WHERE organization_id = $1 AND cash_drawer_id = $2 AND status IN ('open', 'closing')`,
      [context.organizationId, current.id])).rows[0]) throw cashError(409, "POS_SHIFT_DRAWER_IN_USE", "This drawer is held by an open cash session.");
    const row = (await client.query(`UPDATE tenant.pos_cash_drawers SET code = $3, name = $4, status = $5, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING *`,
      [context.organizationId, current.id, code, name, status])).rows[0];
    await event(client, context, "cash_drawer", row.id, "pos.cash_drawer.updated", { code, name, status });
    return row;
  }
  await assertPosStoreAccess(client, context, input.storeId);
  try {
    const row = (await client.query(`INSERT INTO tenant.pos_cash_drawers (organization_id, store_id, code, name, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [context.organizationId, input.storeId, code, name, context.userId])).rows[0];
    await event(client, context, "cash_drawer", row.id, "pos.cash_drawer.created", { code, name, storeId: input.storeId });
    return row;
  } catch (error) {
    if (error?.code === "23505") throw cashError(409, "POS_CASH_DRAWER_INVALID", `${code} is already a drawer at this outlet.`);
    throw error;
  }
}

// Which drawer a counter uses (two counters may share one; only one cash session holds it at a time). Not while a shift is open on the counter.
export async function assignTerminalCashDrawer(client, context, terminalId, drawerId) {
  if (!can(context, POS_TERMINAL_PERMISSIONS.configureCash)) throw cashError(403, "POS_CASH_DRAWER_PERMISSION_DENIED", "You do not have permission to set up cash drawers.");
  const terminal = (await client.query(`SELECT * FROM tenant.pos_terminals WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, terminalId])).rows[0];
  if (!terminal) throw cashError(404, "TERMINAL_NOT_FOUND", "POS terminal not found.");
  await assertPosStoreAccess(client, context, terminal.store_id);
  const drawer = (await client.query(`SELECT * FROM tenant.pos_cash_drawers WHERE organization_id = $1 AND id = $2`, [context.organizationId, drawerId])).rows[0];
  if (!drawer || drawer.store_id !== terminal.store_id) throw cashError(409, "POS_SHIFT_DRAWER_NOT_ASSIGNED", "Choose a drawer of this counter's outlet.");
  if (drawer.status !== "active") throw cashError(409, "POS_CASH_DRAWER_INVALID", "That drawer is inactive.");
  if ((await client.query(`SELECT 1 FROM tenant.pos_shifts WHERE organization_id = $1 AND terminal_id = $2 AND status IN ('open', 'closing')`, [context.organizationId, terminal.id])).rows[0])
    throw cashError(409, "POS_SHIFT_ALREADY_OPEN", "Close the counter's open shift before changing its drawer.");
  await client.query(`UPDATE tenant.pos_terminals SET cash_drawer_id = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, terminal.id, drawer.id]);
  await event(client, context, "terminal", terminal.id, "pos.terminal.cash_drawer_assigned", { from: terminal.cash_drawer_id, to: drawer.id });
  return { terminalId: terminal.id, cashDrawerId: drawer.id, drawerCode: drawer.code };
}
