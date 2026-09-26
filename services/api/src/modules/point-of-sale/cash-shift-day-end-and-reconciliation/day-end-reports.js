// F303 — Day-end / Z report. First of a three-feature sequential chain
// (F303 -> F304 payment reconciliation -> F305 accounting posting); F304
// reads the totals/lineage this module produces, so the shape here is a
// stable contract, not an internal implementation detail.
//
// STATE MACHINE: draft (computed, mutable, re-computable) -> reviewed (a
// supervisor-tier signoff, pos.report.generate) -> closed (locked by a
// DIFFERENT authority, pos.report.finalize — see the self-finalize block
// below) -> [closed reports may additionally receive an append-only linked
// correction row in tenant.pos_day_end_report_corrections; the closed row
// itself never changes — see migration 121's
// pos_day_end_report_protect_closed() trigger, the real enforcement point,
// not just this file's own checks].
//
// SCOPE / DUPLICATE POLICY: generatePosDayEndReport is idempotent BY SCOPE
// (store+terminal+business_date+scope_type, or store+shift for a per-shift
// report), enforced by migration 121's two partial unique indexes — not
// merely by this file's own find-before-insert (a concurrent second caller
// still can't create a duplicate row; the unique index is the real gate).
// Calling it again for a scope that already has a 'draft' report
// RECOMPUTES that same row in place (this is what makes "regenerate against
// the same closed data set twice" reproducible AND lets a late-closing
// shift on the same business day be picked up before review). Calling it
// again once 'reviewed' or 'closed' returns the existing row UNCHANGED — a
// reviewed/closed report's numbers never move silently; a further change is
// a correction record instead.
//
// ONLY CLOSED/COMPLETE FACTS: a still-open shift is never selectable (the
// shift lookup below always filters status='closed'); a still-in-flight
// sale/return (draft, voided, pending_approval, rejected, cancelled) is
// never summed (see the explicit status filters in every aggregate query
// below). This is a hard exclusion, not a block-and-retry.
//
// TIMEZONE / BUSINESS-DATE CUTOFF: a business date is always computed as
// `(<timestamptz> AT TIME ZONE store.timezone)::date` — the store's own
// configured IANA zone (tenant.pos_stores.timezone), never server UTC and
// never a browser's local zone. For a shift-scoped report this is derived
// once from that shift's own closed_at and frozen on the row; for a
// business-day report the caller supplies the target business date and
// every CLOSED shift whose closed_at falls on that date in the store's zone
// is included.
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { requireCompanyRecord } from "../../../core/references.js";
import { add, sub, decimal, asDatabaseDecimal } from "../../../core/decimal.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess } from "../shared/access-control.js";
import { event as auditEvent } from "../shared/audit.js";

const SCOPE_TYPES = ["shift", "business_day"];
const VARIANCE_TYPES = ["cash_variance", "total_adjustment", "reclassification", "other"];
const BUSINESS_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function event(client, context, reportId, eventType, payload = {}) {
  return auditEvent(client, context, "pos_day_end_report", reportId, eventType, payload);
}

// Resolves exactly which CLOSED shift(s) a generation request covers, and
// the frozen business_date for the resulting report row. Never selects an
// open shift; for scope_type='business_day' an empty shift set is valid
// (a business day with nothing closed yet produces an all-zero report,
// which is itself useful signal, not an error).
async function resolveScope(client, context, store, input) {
  const scopeType = String(input.scopeType || "").trim();
  if (!SCOPE_TYPES.includes(scopeType)) {
    throw posError(400, `scopeType must be one of ${SCOPE_TYPES.join(", ")}.`, "POS_DAY_END_SCOPE_TYPE_INVALID");
  }

  if (scopeType === "shift") {
    if (!input.shiftId) throw posError(400, "shiftId is required for a shift-scoped day-end report.", "POS_DAY_END_SHIFT_REQUIRED");
    const shiftResult = await client.query(
      `SELECT shift.*, (shift.closed_at AT TIME ZONE store.timezone)::date AS business_date
       FROM tenant.pos_shifts shift
       JOIN tenant.pos_stores store ON store.organization_id=shift.organization_id AND store.id=shift.store_id
       WHERE shift.organization_id=$1 AND shift.company_id=$2 AND shift.id=$3
         AND shift.store_id=$4 AND shift.status='closed'`,
      [context.organizationId, context.companyId, input.shiftId, store.id],
    );
    const shift = shiftResult.rows[0];
    if (!shift) {
      throw posError(409, "An eligible CLOSED shift on this store is required to generate a shift Z report.", "POS_DAY_END_SHIFT_NOT_CLOSED");
    }
    if (input.terminalId && input.terminalId !== shift.terminal_id) {
      throw posError(409, "The selected shift does not belong to the selected terminal.", "POS_TERMINAL_STORE_MISMATCH");
    }
    return {
      scopeType,
      shiftId: shift.id,
      terminalId: shift.terminal_id,
      businessDate: shift.business_date,
      shiftIds: [shift.id],
    };
  }

  // business_day
  if (!input.businessDate || !BUSINESS_DATE_RE.test(String(input.businessDate))) {
    throw posError(400, "businessDate (YYYY-MM-DD) is required for a business-day day-end report.", "POS_DAY_END_BUSINESS_DATE_REQUIRED");
  }
  let terminalId = null;
  if (input.terminalId) {
    const terminal = await requireCompanyRecord(client, context, "pos_terminal", input.terminalId);
    if (terminal.store_id !== store.id) {
      throw posError(409, "The selected terminal does not belong to the selected store.", "POS_TERMINAL_STORE_MISMATCH");
    }
    terminalId = terminal.id;
  }
  const shifts = await client.query(
    `SELECT shift.id
     FROM tenant.pos_shifts shift
     JOIN tenant.pos_stores store ON store.organization_id=shift.organization_id AND store.id=shift.store_id
     WHERE shift.organization_id=$1 AND shift.company_id=$2 AND shift.store_id=$3
       AND ($4::uuid IS NULL OR shift.terminal_id=$4)
       AND shift.status='closed'
       AND (shift.closed_at AT TIME ZONE store.timezone)::date=$5::date
     ORDER BY shift.closed_at`,
    [context.organizationId, context.companyId, store.id, terminalId, input.businessDate],
  );
  return {
    scopeType,
    shiftId: null,
    terminalId,
    businessDate: input.businessDate,
    shiftIds: shifts.rows.map((row) => row.id),
  };
}

async function computeTotals(client, context, shiftIds) {
  const salesAgg = await client.query(
    `SELECT count(*)::int AS sale_count,
            coalesce(sum(subtotal),0)::text AS gross_sales_total,
            coalesce(sum(discount_total),0)::text AS discount_total,
            coalesce(sum(tax_total),0)::text AS tax_total,
            coalesce(sum(rounding_adjustment),0)::text AS rounding_total,
            coalesce(sum(grand_total),0)::text AS grand_sales_total
     FROM tenant.pos_sales
     WHERE organization_id=$1 AND company_id=$2 AND shift_id=ANY($3::uuid[])
       AND status IN ('completed','partially_returned','returned')`,
    [context.organizationId, context.companyId, shiftIds],
  );
  const saleIds = await client.query(
    `SELECT id FROM tenant.pos_sales
     WHERE organization_id=$1 AND company_id=$2 AND shift_id=ANY($3::uuid[])
       AND status IN ('completed','partially_returned','returned')
     ORDER BY id`,
    [context.organizationId, context.companyId, shiftIds],
  );

  const returnsAgg = await client.query(
    `SELECT count(*)::int AS return_count, coalesce(sum(refund_total),0)::text AS return_total
     FROM tenant.pos_returns
     WHERE organization_id=$1 AND company_id=$2 AND shift_id=ANY($3::uuid[]) AND status='completed'`,
    [context.organizationId, context.companyId, shiftIds],
  );
  const returnIds = await client.query(
    `SELECT id FROM tenant.pos_returns
     WHERE organization_id=$1 AND company_id=$2 AND shift_id=ANY($3::uuid[]) AND status='completed'
     ORDER BY id`,
    [context.organizationId, context.companyId, shiftIds],
  );

  const cashAgg = await client.query(
    `SELECT coalesce(sum(amount) FILTER (WHERE movement_type='opening'),0)::text AS opening_cash_total,
            coalesce(sum(amount) FILTER (WHERE movement_type='paid_in'),0)::text AS paid_in_total,
            coalesce(sum(amount) FILTER (WHERE movement_type='paid_out'),0)::text AS paid_out_total,
            coalesce(sum(amount),0)::text AS expected_cash_total
     FROM tenant.pos_cash_movements
     WHERE organization_id=$1 AND company_id=$2 AND shift_id=ANY($3::uuid[])`,
    [context.organizationId, context.companyId, shiftIds],
  );
  const cashMovementIds = await client.query(
    `SELECT id FROM tenant.pos_cash_movements
     WHERE organization_id=$1 AND company_id=$2 AND shift_id=ANY($3::uuid[])
     ORDER BY id`,
    [context.organizationId, context.companyId, shiftIds],
  );

  const countedAgg = await client.query(
    `SELECT count(*) FILTER (WHERE counted_cash IS NOT NULL)::int AS counted_count,
            coalesce(sum(counted_cash),0)::text AS counted_cash_total
     FROM tenant.pos_shifts
     WHERE organization_id=$1 AND company_id=$2 AND id=ANY($3::uuid[])`,
    [context.organizationId, context.companyId, shiftIds],
  );

  const tenderAgg = await client.query(
    `SELECT payment.payment_method AS method,
            coalesce(sum(payment.amount),0)::text AS amount,
            count(*)::int AS count
     FROM tenant.pos_payments payment
     JOIN tenant.pos_sales sale
       ON sale.organization_id=payment.organization_id AND sale.id=payment.sale_id
     WHERE payment.organization_id=$1 AND payment.company_id=$2 AND payment.shift_id=ANY($3::uuid[])
       AND sale.status IN ('completed','partially_returned','returned')
     GROUP BY payment.payment_method
     ORDER BY payment.payment_method`,
    [context.organizationId, context.companyId, shiftIds],
  );

  const grossSalesTotal = decimal(salesAgg.rows[0].gross_sales_total);
  const discountTotal = decimal(salesAgg.rows[0].discount_total);
  const netSalesTotal = sub(grossSalesTotal, discountTotal);
  const expectedCashTotal = decimal(cashAgg.rows[0].expected_cash_total);
  const countedCashTotal = countedAgg.rows[0].counted_count > 0 ? decimal(countedAgg.rows[0].counted_cash_total) : null;
  const cashVarianceTotal = sub(countedCashTotal ?? decimal(0), expectedCashTotal);

  return {
    saleCount: salesAgg.rows[0].sale_count,
    grossSalesTotal: asDatabaseDecimal(grossSalesTotal),
    discountTotal: asDatabaseDecimal(discountTotal),
    taxTotal: asDatabaseDecimal(decimal(salesAgg.rows[0].tax_total)),
    netSalesTotal: asDatabaseDecimal(netSalesTotal),
    roundingTotal: asDatabaseDecimal(decimal(salesAgg.rows[0].rounding_total)),
    grandSalesTotal: asDatabaseDecimal(decimal(salesAgg.rows[0].grand_sales_total)),
    returnCount: returnsAgg.rows[0].return_count,
    returnTotal: asDatabaseDecimal(decimal(returnsAgg.rows[0].return_total)),
    openingCashTotal: asDatabaseDecimal(decimal(cashAgg.rows[0].opening_cash_total)),
    paidInTotal: asDatabaseDecimal(decimal(cashAgg.rows[0].paid_in_total)),
    paidOutTotal: asDatabaseDecimal(decimal(cashAgg.rows[0].paid_out_total)),
    expectedCashTotal: asDatabaseDecimal(expectedCashTotal),
    countedCashTotal: countedCashTotal != null ? asDatabaseDecimal(countedCashTotal) : null,
    cashVarianceTotal: asDatabaseDecimal(cashVarianceTotal),
    tenderTotals: tenderAgg.rows.map((row) => ({ method: row.method, amount: asDatabaseDecimal(decimal(row.amount)), count: row.count })),
    lineage: {
      shiftIds,
      saleIds: saleIds.rows.map((row) => row.id),
      returnIds: returnIds.rows.map((row) => row.id),
      cashMovementIds: cashMovementIds.rows.map((row) => row.id),
    },
  };
}

export async function generatePosDayEndReport(client, context, input = {}) {
  requirePermission(context, "pos.report.generate");
  if (!input.storeId) throw posError(400, "storeId is required.", "POS_DAY_END_STORE_REQUIRED");
  await assertPosStoreAccess(client, context, input.storeId);

  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "pos.day_end_report.generate",
    key: input.idempotencyKey,
    payload: { ...input, idempotencyKey: undefined },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };

  const store = await requireCompanyRecord(client, context, "pos_store", input.storeId);
  const scope = await resolveScope(client, context, store, input);

  const existingResult =
    scope.scopeType === "shift"
      ? await client.query(
          `SELECT * FROM tenant.pos_day_end_reports
           WHERE organization_id=$1 AND shift_id=$2 AND status<>'void' FOR UPDATE`,
          [context.organizationId, scope.shiftId],
        )
      : await client.query(
          `SELECT * FROM tenant.pos_day_end_reports
           WHERE organization_id=$1 AND company_id=$2 AND store_id=$3
             AND coalesce(terminal_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce($4::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
             AND business_date=$5 AND scope_type='business_day' AND status<>'void'
           FOR UPDATE`,
          [context.organizationId, context.companyId, store.id, scope.terminalId, scope.businessDate],
        );
  const existing = existingResult.rows[0] || null;

  // Once reviewed or closed, a further generate() call is a pure,
  // side-effect-free replay of the existing snapshot — the numbers a
  // reviewer/finalizer signed off on never move under them.
  if (existing && existing.status !== "draft") {
    const response = { ...existing, replayed: true };
    await completeIdempotentOperation(client, context, idempotency, {
      response,
      aggregateType: "pos_day_end_report",
      aggregateId: existing.id,
    });
    return response;
  }

  const totals = await computeTotals(client, context, scope.shiftIds);

  let report;
  if (existing) {
    const updated = await client.query(
      `UPDATE tenant.pos_day_end_reports
       SET sale_count=$3,gross_sales_total=$4,discount_total=$5,tax_total=$6,net_sales_total=$7,
           rounding_total=$8,grand_sales_total=$9,return_count=$10,return_total=$11,tender_totals=$12::jsonb,
           opening_cash_total=$13,paid_in_total=$14,paid_out_total=$15,expected_cash_total=$16,
           counted_cash_total=$17,cash_variance_total=$18,lineage=$19::jsonb,updated_at=now()
       WHERE organization_id=$1 AND id=$2 AND status='draft'
       RETURNING *`,
      [
        context.organizationId,
        existing.id,
        totals.saleCount,
        totals.grossSalesTotal,
        totals.discountTotal,
        totals.taxTotal,
        totals.netSalesTotal,
        totals.roundingTotal,
        totals.grandSalesTotal,
        totals.returnCount,
        totals.returnTotal,
        JSON.stringify(totals.tenderTotals),
        totals.openingCashTotal,
        totals.paidInTotal,
        totals.paidOutTotal,
        totals.expectedCashTotal,
        totals.countedCashTotal,
        totals.cashVarianceTotal,
        JSON.stringify(totals.lineage),
      ],
    );
    if (!updated.rows[0]) throw posError(409, "This day-end report changed state concurrently. Retry.", "POS_DAY_END_STATE_CONFLICT");
    report = updated.rows[0];
    await event(client, context, report.id, "pos.day_end_report.recalculated", { saleCount: totals.saleCount });
  } else {
    const reportNumber = await nextDocumentNumber(client, context, {
      documentType: "pos_day_end_report",
      prefix: "ZREP",
      periodKey: `${store.id}:${scope.terminalId || "all"}:${scope.businessDate}:${scope.scopeType}`,
      padding: 6,
    });
    const inserted = await client.query(
      `INSERT INTO tenant.pos_day_end_reports
        (organization_id,company_id,store_id,terminal_id,scope_type,shift_id,business_date,status,report_number,
         sale_count,gross_sales_total,discount_total,tax_total,net_sales_total,rounding_total,grand_sales_total,
         return_count,return_total,tender_totals,opening_cash_total,paid_in_total,paid_out_total,expected_cash_total,
         counted_cash_total,cash_variance_total,lineage,generated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21,$22,$23,$24,$25::jsonb,$26)
       RETURNING *`,
      [
        context.organizationId,
        context.companyId,
        store.id,
        scope.terminalId,
        scope.scopeType,
        scope.shiftId,
        scope.businessDate,
        reportNumber,
        totals.saleCount,
        totals.grossSalesTotal,
        totals.discountTotal,
        totals.taxTotal,
        totals.netSalesTotal,
        totals.roundingTotal,
        totals.grandSalesTotal,
        totals.returnCount,
        totals.returnTotal,
        JSON.stringify(totals.tenderTotals),
        totals.openingCashTotal,
        totals.paidInTotal,
        totals.paidOutTotal,
        totals.expectedCashTotal,
        totals.countedCashTotal,
        totals.cashVarianceTotal,
        JSON.stringify(totals.lineage),
        context.userId,
      ],
    );
    report = inserted.rows[0];
    await event(client, context, report.id, "pos.day_end_report.generated", { saleCount: totals.saleCount, scopeType: scope.scopeType });
  }

  const response = { ...report, replayed: false };
  await completeIdempotentOperation(client, context, idempotency, {
    response,
    aggregateType: "pos_day_end_report",
    aggregateId: report.id,
  });
  return response;
}

async function lockReport(client, context, reportId) {
  const result = await client.query(
    `SELECT * FROM tenant.pos_day_end_reports WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, reportId],
  );
  if (!result.rows[0]) throw posError(404, "POS day-end report was not found.", "POS_DAY_END_REPORT_NOT_FOUND");
  return result.rows[0];
}

export async function reviewPosDayEndReport(client, context, reportId, input = {}) {
  requirePermission(context, "pos.report.generate");
  const report = await lockReport(client, context, reportId);
  await assertPosStoreAccess(client, context, report.store_id);
  if (report.status === "reviewed") return { ...report, replayed: true };
  if (report.status !== "draft") {
    throw posError(409, `Only a draft POS day-end report can be reviewed (this one is ${report.status}).`, "POS_DAY_END_STATE_INVALID");
  }
  const updated = await client.query(
    `UPDATE tenant.pos_day_end_reports
     SET status='reviewed',reviewed_by=$4,reviewed_at=now(),updated_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='draft'
     RETURNING *`,
    [context.organizationId, context.companyId, reportId, context.userId],
  );
  if (!updated.rows[0]) throw posError(409, "This day-end report changed state concurrently. Retry.", "POS_DAY_END_STATE_CONFLICT");
  await event(client, context, reportId, "pos.day_end_report.reviewed", { reviewNotes: input.reviewNotes || null });
  return { ...updated.rows[0], replayed: false };
}

export async function finalizePosDayEndReport(client, context, reportId, input = {}) {
  requirePermission(context, "pos.report.finalize");
  const report = await lockReport(client, context, reportId);
  await assertPosStoreAccess(client, context, report.store_id);
  if (report.status === "closed") return { ...report, replayed: true };
  if (report.status !== "reviewed") {
    throw posError(409, `Only a reviewed POS day-end report can be finalized (this one is ${report.status}).`, "POS_DAY_END_STATE_INVALID");
  }
  // Maker-checker: the authority that locks the report must differ from
  // the authority that generated its draft (see the pos_day_end_generate_finalize
  // SoD conflict in packages/permissions/src/roles.js). Mirrors the
  // existing SELF_APPROVAL_BLOCKED pattern in approvePointOfSaleReturn().
  if (report.generated_by === context.userId) {
    throw posError(409, "The person who generated this report cannot also finalize it.", "POS_DAY_END_SELF_FINALIZE_BLOCKED");
  }
  const updated = await client.query(
    `UPDATE tenant.pos_day_end_reports
     SET status='closed',finalized_by=$4,finalized_at=now(),updated_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='reviewed'
     RETURNING *`,
    [context.organizationId, context.companyId, reportId, context.userId],
  );
  if (!updated.rows[0]) throw posError(409, "This day-end report changed state concurrently. Retry.", "POS_DAY_END_STATE_CONFLICT");
  await event(client, context, reportId, "pos.day_end_report.finalized", { closeNotes: input.closeNotes || null });
  return { ...updated.rows[0], replayed: false };
}

// Post-close correction. The original CLOSED report row is never touched —
// migration 121's trigger would reject any attempt to do so anyway; this
// function only ever INSERTs into the append-only corrections table.
export async function recordPosDayEndVariance(client, context, reportId, input = {}) {
  requirePermission(context, "pos.report.finalize");
  const report = await lockReport(client, context, reportId);
  await assertPosStoreAccess(client, context, report.store_id);
  if (report.status !== "closed") {
    throw posError(409, "Only a closed POS day-end report can receive a linked correction.", "POS_DAY_END_STATE_INVALID");
  }
  const varianceType = String(input.varianceType || "").trim();
  if (!VARIANCE_TYPES.includes(varianceType)) {
    throw posError(400, `varianceType must be one of ${VARIANCE_TYPES.join(", ")}.`, "POS_DAY_END_VARIANCE_TYPE_INVALID");
  }
  if (!input.reason || !String(input.reason).trim()) {
    throw posError(400, "A reason is required to record a day-end report correction.", "POS_DAY_END_VARIANCE_REASON_REQUIRED");
  }
  const correctionNumber = await nextDocumentNumber(client, context, {
    documentType: "pos_day_end_correction",
    prefix: "ZCORR",
    periodKey: reportId,
    padding: 4,
  });
  const inserted = await client.query(
    `INSERT INTO tenant.pos_day_end_report_corrections
      (organization_id,company_id,original_report_id,correction_number,variance_type,reason,adjustment,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      reportId,
      correctionNumber,
      varianceType,
      String(input.reason).trim(),
      JSON.stringify(input.adjustment || []),
      context.userId,
    ],
  );
  await event(client, context, reportId, "pos.day_end_report.correction_recorded", {
    correctionId: inserted.rows[0].id,
    varianceType,
  });
  return inserted.rows[0];
}

export async function listPosDayEndReports(client, context, options = {}) {
  requirePermission(context, "pos.report.view");
  const values = [context.organizationId, context.companyId];
  const clauses = [];
  if (options.storeId) {
    values.push(options.storeId);
    clauses.push(`store_id=$${values.length}`);
  }
  if (options.terminalId) {
    values.push(options.terminalId);
    clauses.push(`terminal_id=$${values.length}`);
  }
  if (options.status) {
    values.push(options.status);
    clauses.push(`status=$${values.length}`);
  }
  if (options.scopeType) {
    values.push(options.scopeType);
    clauses.push(`scope_type=$${values.length}`);
  }
  if (options.businessDateFrom) {
    values.push(options.businessDateFrom);
    clauses.push(`business_date>=$${values.length}`);
  }
  if (options.businessDateTo) {
    values.push(options.businessDateTo);
    clauses.push(`business_date<=$${values.length}`);
  }
  values.push(Math.min(Number(options.limit) || 100, 200), Number(options.offset) || 0);
  const result = await client.query(
    `SELECT * FROM tenant.pos_day_end_reports
     WHERE organization_id=$1 AND company_id=$2 ${clauses.map((c) => `AND ${c}`).join(" ")}
     ORDER BY business_date DESC,created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return result.rows;
}

export async function getPosDayEndReport(client, context, reportId) {
  requirePermission(context, "pos.report.view");
  const result = await client.query(
    `SELECT * FROM tenant.pos_day_end_reports WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [context.organizationId, context.companyId, reportId],
  );
  const report = result.rows[0];
  if (!report) throw posError(404, "POS day-end report was not found.", "POS_DAY_END_REPORT_NOT_FOUND");
  await assertPosStoreAccess(client, context, report.store_id);
  const corrections = await client.query(
    `SELECT * FROM tenant.pos_day_end_report_corrections
     WHERE organization_id=$1 AND original_report_id=$2 ORDER BY created_at`,
    [context.organizationId, reportId],
  );
  return { ...report, corrections: corrections.rows };
}
