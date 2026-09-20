// F306 — Loyalty. Program configuration, balance/ledger queries, the
// cart-pricing preview/eligibility evaluation, and the sale-completion /
// return-reversal commit functions. Mirrors promotions.js/coupons.js's
// shape throughout: configuration is gated on pos.loyalty.manage;
// redeeming an already-configured program's points during checkout only
// needs pos.loyalty.redeem (the redemption VALUE/eligibility is enforced
// by the program's own rules and the customer's own balance, not by
// cashier authority) — see cart.js's redeemPosCartLoyaltyPoints.
//
// SCOPE ADAPTATION: unlike promotions/coupons (many rows, arbitrary
// codes), a loyalty PROGRAM is one row per company (see migration 124's
// comment for why) — so "program CRUD" here is get/upsert/setActive
// rather than list/create/update/setActive against many rows.
//
// BUSINESS RULES (the F306 dossier explicitly leaves these as
// implementation decisions; documented here as the single source of
// truth for all three):
//
// 1. EARN TIMING/BASIS: points are earned only on a COMPLETED sale
//    (never a draft/priced cart, never a freely-editable balance field),
//    computed per SALE LINE on that line's final taxable_amount — i.e.
//    AFTER every discount layer (manual, promotion, coupon, cart-level,
//    loyalty redemption itself) has already reduced it, but BEFORE tax.
//    Excluding tax from the earn base means a customer is never rewarded
//    loyalty points for the tax they paid; excluding the redeemed-points
//    portion means points can never be earned on money the customer
//    didn't actually spend (no earn-on-redemption compounding loop).
//
// 2. REDEMPTION/TAX ORDER: redeemed points reduce a line's taxable base
//    BEFORE tax is computed — exactly the same "every discount layer
//    applies before tax" policy cart-pricing.js already documents and
//    applies to manual/promotion/coupon/cart discounts. This keeps
//    loyalty internally consistent with every other POS discount
//    mechanism rather than inventing a second, divergent tax-order rule
//    for just this one feature. Redemption amount is always capped so the
//    sale total can never go negative (see computePosLoyaltyRedemption).
//
// 3. PARTIAL-RETURN PROPORTIONALITY: both an earn reversal and a
//    redemption reversal are computed per RETURNED sale line, as
//    originalLineValue * (returnedQuantityThisEvent / originalSoldQuantity),
//    using services/api/src/core/decimal.js exact arithmetic throughout —
//    the same per-unit-proportional model createPointOfSaleReturn already
//    uses for the cash refund amount itself (perUnitRefund =
//    line_total/soldQuantity), applied here to points instead of
//    currency. A full return (returnedQuantity == soldQuantity) reverses
//    exactly 100% of that line's points by construction. Reversal is
//    always a NEW ledger entry referencing the original entry it
//    reverses (original_entry_id) — never an edit to the original earn/
//    redeem row, and never a direct balance mutation: the balance cache
//    is only ever updated in the same statement as a ledger insert, under
//    that customer's own balance-row lock.
import { add, sub, mul, div, percent, max, min, decimal, asDatabaseDecimal } from "../../../core/decimal.js";
import { posError } from "../shared/errors.js";
import { requirePermission } from "../shared/access-control.js";

// F306 non-negotiable: loyalty must key off the SAME business_parties.id
// the rest of POS (setPosCartCustomer, completePointOfSale) already
// validates against — never a second, POS-only customer identity.
async function requireLoyaltyCustomer(client, context, customerId) {
  const result = await client.query(
    `SELECT id FROM tenant.business_parties
     WHERE organization_id=$1 AND (company_id IS NULL OR company_id=$2) AND id=$3 AND party_type IN ('customer','both') AND status='active'`,
    [context.organizationId, context.companyId, customerId],
  );
  if (!result.rows[0]) throw posError(404, "Customer was not found or is not an active customer for this company.", "POS_CUSTOMER_NOT_FOUND");
  return result.rows[0];
}

function validateProgramInput(input) {
  if (!input.name || !String(input.name).trim()) throw posError(400, "A program name is required.", "POS_LOYALTY_NAME_REQUIRED");
  if (!(Number(input.earnRatePointsPerCurrency) > 0)) {
    throw posError(400, "Earn rate must be greater than zero.", "POS_LOYALTY_EARN_RATE_INVALID");
  }
  if (!(Number(input.redemptionValuePerPoint) > 0)) {
    throw posError(400, "Redemption value per point must be greater than zero.", "POS_LOYALTY_REDEMPTION_VALUE_INVALID");
  }
  if (input.minRedemptionPoints != null && Number(input.minRedemptionPoints) < 0) {
    throw posError(400, "Minimum redemption points cannot be negative.", "POS_LOYALTY_MIN_REDEMPTION_INVALID");
  }
  if (input.maxRedemptionPointsPerSale != null && !(Number(input.maxRedemptionPointsPerSale) > 0)) {
    throw posError(400, "Maximum redemption points per sale must be greater than zero.", "POS_LOYALTY_MAX_REDEMPTION_INVALID");
  }
  if (
    input.maxRedemptionPercentOfPayable != null &&
    (Number(input.maxRedemptionPercentOfPayable) < 0 || Number(input.maxRedemptionPercentOfPayable) > 100)
  ) {
    throw posError(400, "Maximum redemption percent must be between 0 and 100.", "POS_LOYALTY_MAX_PERCENT_INVALID");
  }
}

export async function getPosLoyaltyProgram(client, context) {
  requirePermission(context, "pos.view");
  const result = await client.query(`SELECT * FROM tenant.pos_loyalty_programs WHERE organization_id=$1 AND company_id=$2`, [
    context.organizationId,
    context.companyId,
  ]);
  return result.rows[0] || null;
}

export async function upsertPosLoyaltyProgram(client, context, input) {
  requirePermission(context, "pos.loyalty.manage");
  validateProgramInput(input);
  const result = await client.query(
    `INSERT INTO tenant.pos_loyalty_programs
      (organization_id,company_id,name,earn_rate_points_per_currency,redemption_value_per_point,
       min_redemption_points,max_redemption_points_per_sale,max_redemption_percent_of_payable,
       min_eligible_sale_amount,points_expiry_days,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (organization_id,company_id) DO UPDATE SET
       name=EXCLUDED.name,
       earn_rate_points_per_currency=EXCLUDED.earn_rate_points_per_currency,
       redemption_value_per_point=EXCLUDED.redemption_value_per_point,
       min_redemption_points=EXCLUDED.min_redemption_points,
       max_redemption_points_per_sale=EXCLUDED.max_redemption_points_per_sale,
       max_redemption_percent_of_payable=EXCLUDED.max_redemption_percent_of_payable,
       min_eligible_sale_amount=EXCLUDED.min_eligible_sale_amount,
       points_expiry_days=EXCLUDED.points_expiry_days,
       updated_by=$11,
       updated_at=now()
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      String(input.name).trim(),
      input.earnRatePointsPerCurrency,
      input.redemptionValuePerPoint,
      input.minRedemptionPoints || 0,
      input.maxRedemptionPointsPerSale || null,
      input.maxRedemptionPercentOfPayable ?? null,
      input.minEligibleSaleAmount || 0,
      input.pointsExpiryDays || null,
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function setPosLoyaltyProgramActive(client, context, active) {
  requirePermission(context, "pos.loyalty.manage");
  const result = await client.query(
    `UPDATE tenant.pos_loyalty_programs SET status=$3,updated_by=$4,updated_at=now()
     WHERE organization_id=$1 AND company_id=$2 RETURNING *`,
    [context.organizationId, context.companyId, active ? "active" : "inactive", context.userId],
  );
  if (!result.rows[0]) throw posError(404, "No loyalty program is configured for this company yet.", "POS_LOYALTY_PROGRAM_NOT_CONFIGURED");
  return result.rows[0];
}

export async function getPosCustomerLoyaltyBalance(client, context, customerId) {
  requirePermission(context, "pos.view");
  const customer = await requireLoyaltyCustomer(client, context, customerId);
  const result = await client.query(`SELECT balance,updated_at FROM tenant.pos_loyalty_balances WHERE organization_id=$1 AND customer_id=$2`, [
    context.organizationId,
    customer.id,
  ]);
  return { customerId: customer.id, balance: asDatabaseDecimal(decimal(result.rows[0]?.balance ?? 0)), updatedAt: result.rows[0]?.updated_at || null };
}

export async function listPosCustomerLoyaltyLedger(client, context, customerId, { limit = 50 } = {}) {
  requirePermission(context, "pos.view");
  const customer = await requireLoyaltyCustomer(client, context, customerId);
  const boundedLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const result = await client.query(
    `SELECT * FROM tenant.pos_loyalty_ledger WHERE organization_id=$1 AND customer_id=$2 ORDER BY created_at DESC, id DESC LIMIT $3`,
    [context.organizationId, customer.id, boundedLimit],
  );
  return result.rows;
}

export async function adjustPosCustomerLoyaltyBalance(client, context, customerId, points, reason) {
  requirePermission(context, "pos.loyalty.manage");
  const customer = await requireLoyaltyCustomer(client, context, customerId);
  const delta = decimal(points);
  if (delta === 0n) throw posError(400, "Adjustment points must not be zero.", "POS_LOYALTY_ADJUSTMENT_INVALID");
  if (!reason || !String(reason).trim()) throw posError(400, "A reason is required for a manual loyalty adjustment.", "POS_LOYALTY_ADJUSTMENT_REASON_REQUIRED");
  const program = await resolveActivePosLoyaltyProgram(client, context);
  await lockOrCreateBalanceRow(client, context, customer.id);
  await client.query(
    `INSERT INTO tenant.pos_loyalty_ledger (organization_id,company_id,program_id,customer_id,entry_type,points,created_by,reason)
     VALUES ($1,$2,$3,$4,'adjust',$5,$6,$7)`,
    [context.organizationId, context.companyId, program?.id || null, customer.id, asDatabaseDecimal(delta), context.userId, String(reason).trim()],
  );
  const updated = await client.query(
    `UPDATE tenant.pos_loyalty_balances SET balance=balance+$3,updated_at=now() WHERE organization_id=$1 AND customer_id=$2 RETURNING balance`,
    [context.organizationId, customer.id, asDatabaseDecimal(delta)],
  );
  return { customerId: customer.id, balance: updated.rows[0].balance };
}

// F306-CAP-001 (expiry): retire points that have outlived the program's
// points_expiry_days. Until now the number was stored and shown but nothing
// ever acted on it, so "points expire after N days" was configuration
// without effect.
//
// MODEL (documented because the dossier leaves it to the implementation):
// only 'earn' entries expire (a manual adjustment or a reversed redemption
// is not a purchase reward), and every DEBIT against the customer -- a
// redemption, a reversed earn, an earlier expiry, a negative adjustment --
// consumes the OLDEST points first (FIFO). Therefore
//
//   expirable = earned-before-cutoff  -  all debits ever posted,  capped at the live balance
//
// which is deliberately conservative: it can under-expire (a debit that
// really consumed a newer point still "uses up" an older one) but can never
// expire a point the customer is still entitled to. Every expiry is a NEW
// negative 'expire' ledger row and a balance update under that customer's own
// row lock, in the same transaction -- the ledger is never edited. Because
// earlier expiry rows are themselves debits, running this again immediately
// finds nothing left to expire, so a retry or a double click is harmless.
export async function expirePosLoyaltyPoints(client, context, { asOf = null, limit = 500 } = {}) {
  requirePermission(context, "pos.loyalty.manage");
  const program = await resolveActivePosLoyaltyProgram(client, context);
  if (!program || !program.points_expiry_days) {
    return { expiryDays: null, cutoff: null, customersExpired: 0, pointsExpired: asDatabaseDecimal(decimal(0)), skippedReason: program ? "no_expiry_configured" : "no_active_program" };
  }
  const reference = asOf ? new Date(asOf) : new Date();
  if (Number.isNaN(reference.getTime())) throw posError(400, "asOf is not a valid date.", "POS_LOYALTY_EXPIRY_ASOF_INVALID");
  const cutoff = new Date(reference.getTime() - Number(program.points_expiry_days) * 24 * 60 * 60 * 1000);
  const boundedLimit = Math.min(1000, Math.max(1, Number(limit) || 500));

  const candidates = await client.query(
    `SELECT customer_id,
            COALESCE(SUM(points) FILTER (WHERE entry_type='earn' AND created_at < $3),0) AS old_earned,
            COALESCE(SUM(-points) FILTER (WHERE points < 0),0) AS debits
       FROM tenant.pos_loyalty_ledger
      WHERE organization_id=$1 AND company_id=$2
      GROUP BY customer_id
     HAVING COALESCE(SUM(points) FILTER (WHERE entry_type='earn' AND created_at < $3),0) > COALESCE(SUM(-points) FILTER (WHERE points < 0),0)
      ORDER BY customer_id
      LIMIT $4`,
    [context.organizationId, context.companyId, cutoff.toISOString(), boundedLimit],
  );

  let pointsExpired = decimal(0);
  let customersExpired = 0;
  for (const candidate of candidates.rows) {
    // Re-derive under the balance lock: a redemption committed between the
    // scan above and this lock must not be expired out from under.
    const balance = await lockOrCreateBalanceRow(client, context, candidate.customer_id);
    const totals = await client.query(
      `SELECT COALESCE(SUM(points) FILTER (WHERE entry_type='earn' AND created_at < $4),0) AS old_earned,
              COALESCE(SUM(-points) FILTER (WHERE points < 0),0) AS debits
         FROM tenant.pos_loyalty_ledger
        WHERE organization_id=$1 AND company_id=$2 AND customer_id=$3`,
      [context.organizationId, context.companyId, candidate.customer_id, cutoff.toISOString()],
    );
    const expirable = min(sub(decimal(totals.rows[0].old_earned), decimal(totals.rows[0].debits)), balance);
    if (expirable <= 0n) continue;

    await client.query(
      `INSERT INTO tenant.pos_loyalty_ledger (organization_id,company_id,program_id,customer_id,entry_type,points,created_by,reason)
       VALUES ($1,$2,$3,$4,'expire',$5,$6,$7)`,
      [
        context.organizationId,
        context.companyId,
        program.id,
        candidate.customer_id,
        asDatabaseDecimal(sub(decimal(0), expirable)),
        context.userId,
        `Points earned before ${cutoff.toISOString().slice(0, 10)} expired (${program.points_expiry_days}-day expiry)`,
      ],
    );
    await client.query(`UPDATE tenant.pos_loyalty_balances SET balance=balance-$3,updated_at=now() WHERE organization_id=$1 AND customer_id=$2`, [
      context.organizationId,
      candidate.customer_id,
      asDatabaseDecimal(expirable),
    ]);
    pointsExpired = add(pointsExpired, expirable);
    customersExpired += 1;
  }
  return {
    expiryDays: Number(program.points_expiry_days),
    cutoff: cutoff.toISOString(),
    customersExpired,
    pointsExpired: asDatabaseDecimal(pointsExpired),
    // true when the batch limit was hit, so the caller knows to run again.
    moreRemaining: candidates.rows.length >= boundedLimit,
  };
}

// --- cart-pricing.js integration -------------------------------------

export async function resolveActivePosLoyaltyProgram(client, context) {
  const result = await client.query(`SELECT * FROM tenant.pos_loyalty_programs WHERE organization_id=$1 AND company_id=$2 AND status='active'`, [
    context.organizationId,
    context.companyId,
  ]);
  return result.rows[0] || null;
}

// Read-only, unlocked balance snapshot for preview/reprice. NEVER the
// authoritative check for whether a redemption can actually be committed
// — see commitPosLoyaltyForSale's row-locked recheck for that.
export async function getPosLoyaltyBalanceValue(client, context, customerId) {
  if (!customerId) return decimal(0);
  const result = await client.query(`SELECT balance FROM tenant.pos_loyalty_balances WHERE organization_id=$1 AND customer_id=$2`, [
    context.organizationId,
    customerId,
  ]);
  return decimal(result.rows[0]?.balance ?? 0);
}

// Eligibility gate for a REQUESTED point redemption, called both when the
// cashier first requests it (redeemPosCartLoyaltyPoints) and on every
// subsequent reprice (mirrors evaluateCoupon's own "re-validate on every
// reprice, hard-fail if now ineligible" precedent in cart-pricing.js).
// `balance` is the unlocked preview snapshot — this can still say "looks
// fine" for a redemption that a genuinely concurrent transaction is about
// to consume; that race is only closed by commitPosLoyaltyForSale's
// row-locked recheck at actual sale completion.
export function requirePosLoyaltyRedemptionEligible(program, balance, requestedPoints) {
  const requested = decimal(requestedPoints);
  if (requested <= 0n) return decimal(0);
  if (!program || program.status !== "active") {
    throw posError(409, "No active loyalty program is configured for this company.", "POS_LOYALTY_PROGRAM_NOT_CONFIGURED");
  }
  if (decimal(program.min_redemption_points) > 0n && requested < decimal(program.min_redemption_points)) {
    throw posError(409, `A minimum of ${program.min_redemption_points} points is required to redeem.`, "POS_LOYALTY_BELOW_MINIMUM");
  }
  if (program.max_redemption_points_per_sale != null && requested > decimal(program.max_redemption_points_per_sale)) {
    throw posError(409, `A maximum of ${program.max_redemption_points_per_sale} points can be redeemed per sale.`, "POS_LOYALTY_LIMIT_EXCEEDED");
  }
  if (requested > balance) {
    throw posError(409, "The customer does not have enough loyalty points for this redemption.", "POS_LOYALTY_INSUFFICIENT_BALANCE");
  }
  return requested;
}

// Turns an already-eligible point request into an actual currency
// discount, capped so the sale can never be pushed negative and so a
// program's own max-percent-of-payable safety rail is respected. These
// two caps SILENTLY reduce the applied amount/points (a program safety
// rail, not a customer eligibility failure) rather than throwing — the
// customer's own balance/min/max eligibility already hard-failed above if
// applicable.
export function computePosLoyaltyRedemption(program, requestedPoints, payableBase) {
  if (requestedPoints <= 0n || payableBase <= 0n) return { pointsApplied: decimal(0), amount: decimal(0) };
  const rate = decimal(program.redemption_value_per_point);
  let amount = mul(requestedPoints, rate);
  amount = min(amount, payableBase);
  if (program.max_redemption_percent_of_payable != null) {
    amount = min(amount, percent(payableBase, decimal(program.max_redemption_percent_of_payable)));
  }
  const pointsApplied = amount > 0n ? div(amount, rate) : decimal(0);
  return { pointsApplied, amount: max(0, amount) };
}

// Points a line would earn on its FINAL taxable amount (post every
// discount including loyalty redemption itself, pre-tax) — see BUSINESS
// RULE 1 above. Returns zero if no active program.
export function computePosLoyaltyEarnPoints(program, taxableAmount) {
  if (!program || program.status !== "active") return decimal(0);
  if (taxableAmount <= 0n) return decimal(0);
  return mul(taxableAmount, decimal(program.earn_rate_points_per_currency));
}

async function lockOrCreateBalanceRow(client, context, customerId) {
  await client.query(`INSERT INTO tenant.pos_loyalty_balances (organization_id,customer_id,balance) VALUES ($1,$2,0) ON CONFLICT (organization_id,customer_id) DO NOTHING`, [
    context.organizationId,
    customerId,
  ]);
  const result = await client.query(`SELECT balance FROM tenant.pos_loyalty_balances WHERE organization_id=$1 AND customer_id=$2 FOR UPDATE`, [
    context.organizationId,
    customerId,
  ]);
  return decimal(result.rows[0].balance);
}

// Called from completePosCart/completePointOfSale, inside the SAME
// transaction as sale insertion, after the sale + pos_sale_lines rows
// already exist (their ids are needed for the earn ledger's sale_line_id
// FKs). Idempotent on sale id: a replay of the same sale completion (or
// any other replay path that calls this directly, e.g. a future
// offline-sync replay) is detected via a cheap existence check before
// touching anything; the unique ledger indexes from migration 125 are the
// defense-in-depth backstop if two replays somehow race past that check.
export async function commitPosLoyaltyForSale(client, context, { saleId, customerId, programId, lines = [], redeemPointsApplied = 0 }) {
  if (!customerId) return null; // F306 non-negotiable: no customer, no loyalty effect.
  const already = await client.query(
    `SELECT 1 FROM tenant.pos_loyalty_ledger WHERE organization_id=$1 AND sale_id=$2 AND entry_type IN ('earn','redeem') LIMIT 1`,
    [context.organizationId, saleId],
  );
  if (already.rows[0]) return { replayed: true };

  const balanceBefore = await lockOrCreateBalanceRow(client, context, customerId);
  const redeemPoints = decimal(redeemPointsApplied || 0);
  if (redeemPoints > 0n && redeemPoints > balanceBefore) {
    // The authoritative, concurrency-safe recheck — see
    // requirePosLoyaltyRedemptionEligible's comment for why the preview
    // check alone can never be enough.
    throw posError(
      409,
      "The customer's loyalty balance changed and no longer covers this redemption. Remove or reduce the redemption and retry.",
      "POS_LOYALTY_INSUFFICIENT_BALANCE",
    );
  }

  let earnTotal = decimal(0);
  for (const line of lines) {
    const points = decimal(line.points || 0);
    if (points <= 0n) continue;
    await client.query(
      `INSERT INTO tenant.pos_loyalty_ledger (organization_id,company_id,program_id,customer_id,entry_type,points,sale_id,sale_line_id,created_by)
       VALUES ($1,$2,$3,$4,'earn',$5,$6,$7,$8)
       ON CONFLICT DO NOTHING`,
      [context.organizationId, context.companyId, programId || null, customerId, asDatabaseDecimal(points), saleId, line.saleLineId, context.userId],
    );
    earnTotal = add(earnTotal, points);
  }

  if (redeemPoints > 0n) {
    await client.query(
      `INSERT INTO tenant.pos_loyalty_ledger (organization_id,company_id,program_id,customer_id,entry_type,points,sale_id,created_by,reason)
       VALUES ($1,$2,$3,$4,'redeem',$5,$6,$7,'Redeemed at checkout')
       ON CONFLICT DO NOTHING`,
      [context.organizationId, context.companyId, programId || null, customerId, asDatabaseDecimal(decimal(0) - redeemPoints), saleId, context.userId],
    );
  }

  const netDelta = sub(earnTotal, redeemPoints);
  if (netDelta !== 0n) {
    await client.query(`UPDATE tenant.pos_loyalty_balances SET balance=balance+$3,updated_at=now() WHERE organization_id=$1 AND customer_id=$2`, [
      context.organizationId,
      customerId,
      asDatabaseDecimal(netDelta),
    ]);
  }
  return { earnTotal: asDatabaseDecimal(earnTotal), redeemPoints: asDatabaseDecimal(redeemPoints), replayed: false };
}

// Called from completePointOfSaleReturn, inside the SAME transaction as
// the return's own completion. That function's own idempotency-key check
// plus its status='completed' short-circuit guarantee this only ever
// actually runs once per return; the unique ledger indexes are defense in
// depth. `returnedLines` describes the sale lines THIS return event
// touches — soldQuantity is the line's ORIGINAL, immutable sold quantity,
// returnQuantity is the quantity being returned in THIS event only (never
// a cumulative total) and redeemPoints is that line's own
// loyalty_redeem_points snapshot from pos_sale_lines — see PARTIAL-RETURN
// PROPORTIONALITY at the top of this file.
export async function reversePosLoyaltyForReturn(client, context, { returnId, saleId, customerId, programId, returnedLines = [] }) {
  if (!customerId) return null;
  const earnRows = await client.query(`SELECT id,sale_line_id,points FROM tenant.pos_loyalty_ledger WHERE organization_id=$1 AND sale_id=$2 AND entry_type='earn'`, [
    context.organizationId,
    saleId,
  ]);
  const earnBySaleLine = new Map(earnRows.rows.map((row) => [row.sale_line_id, row]));
  const redeemRowResult = await client.query(`SELECT id,points FROM tenant.pos_loyalty_ledger WHERE organization_id=$1 AND sale_id=$2 AND entry_type='redeem'`, [
    context.organizationId,
    saleId,
  ]);
  const redeemRow = redeemRowResult.rows[0] || null;
  if (!earnBySaleLine.size && !redeemRow) return null; // sale had no loyalty activity at all

  await lockOrCreateBalanceRow(client, context, customerId);
  let netDelta = decimal(0);

  for (const line of returnedLines) {
    const earnRow = earnBySaleLine.get(line.saleLineId);
    if (!earnRow) continue;
    const soldQuantity = decimal(line.soldQuantity);
    const returnQuantity = decimal(line.returnQuantity);
    if (soldQuantity <= 0n || returnQuantity <= 0n) continue;
    const originalPoints = decimal(earnRow.points); // stored positive
    const reversalPoints = mul(originalPoints, div(returnQuantity, soldQuantity));
    if (reversalPoints <= 0n) continue;
    await client.query(
      `INSERT INTO tenant.pos_loyalty_ledger
        (organization_id,company_id,program_id,customer_id,entry_type,points,sale_id,sale_line_id,return_id,original_entry_id,created_by,reason)
       VALUES ($1,$2,$3,$4,'reverse_earn',$5,$6,$7,$8,$9,$10,'Return reversal')
       ON CONFLICT DO NOTHING`,
      [
        context.organizationId,
        context.companyId,
        programId || null,
        customerId,
        asDatabaseDecimal(decimal(0) - reversalPoints),
        saleId,
        line.saleLineId,
        returnId,
        earnRow.id,
        context.userId,
      ],
    );
    netDelta = sub(netDelta, reversalPoints);
  }

  if (redeemRow) {
    const redeemAbs = decimal(redeemRow.points) < 0n ? decimal(0) - decimal(redeemRow.points) : decimal(redeemRow.points);
    let redeemReversal = decimal(0);
    for (const line of returnedLines) {
      const soldQuantity = decimal(line.soldQuantity);
      const returnQuantity = decimal(line.returnQuantity);
      const linePoints = decimal(line.redeemPoints || 0);
      if (soldQuantity <= 0n || returnQuantity <= 0n || linePoints <= 0n) continue;
      redeemReversal = add(redeemReversal, mul(linePoints, div(returnQuantity, soldQuantity)));
    }
    redeemReversal = min(redeemReversal, redeemAbs);
    if (redeemReversal > 0n) {
      await client.query(
        `INSERT INTO tenant.pos_loyalty_ledger
          (organization_id,company_id,program_id,customer_id,entry_type,points,sale_id,return_id,original_entry_id,created_by,reason)
         VALUES ($1,$2,$3,$4,'reverse_redeem',$5,$6,$7,$8,$9,'Return reversal credited back')
         ON CONFLICT DO NOTHING`,
        [context.organizationId, context.companyId, programId || null, customerId, asDatabaseDecimal(redeemReversal), saleId, returnId, redeemRow.id, context.userId],
      );
      netDelta = add(netDelta, redeemReversal);
    }
  }

  if (netDelta !== 0n) {
    await client.query(`UPDATE tenant.pos_loyalty_balances SET balance=balance+$3,updated_at=now() WHERE organization_id=$1 AND customer_id=$2`, [
      context.organizationId,
      customerId,
      asDatabaseDecimal(netDelta),
    ]);
  }
  return { netDelta: asDatabaseDecimal(netDelta) };
}
