// F304 — Payment reconciliation. Ties into F303's closed day-end report
// (see migration 121/127's own comments): a report's own
// reconciliation_status/reconciliation_references/outstanding_exceptions
// columns are written back here, and tenant.pos_reconciliations is keyed
// by (day_end_report_id, payment_method) rather than by shift, since a
// business-day report can span multiple shifts.
//
// "A captured payment is not automatically a settled payment": cash needs
// no external settlement evidence (it's physically in the till the moment
// it's captured) and reconciles directly against F303's own already-
// computed counted-vs-expected cash count. Every other tender method
// reconciles against real settlement evidence supplied by finance ops
// (see importPosSettlementBatch) — this environment has no live,
// merchant-certified payment-provider credential (see
// tender-and-payment-execution/adapter.js's own disclosed limitation), so
// that evidence comes from an imported provider statement/file, or from
// the sandbox adapter's own test-settlement generator for end-to-end
// verification. Nothing here fabricates a settlement.
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { add, sub, decimal, asDatabaseDecimal } from "../../../core/decimal.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess } from "../shared/access-control.js";
import { event as auditEvent } from "../shared/audit.js";

const SETTLEMENT_PAYMENT_METHODS = ["card", "upi", "bank_transfer", "wallet", "store_credit"];

function event(client, context, reconciliationId, eventType, payload = {}) {
  return auditEvent(client, context, "pos_reconciliation", reconciliationId, eventType, payload);
}

async function lockDayEndReport(client, context, reportId) {
  const result = await client.query(
    `SELECT * FROM tenant.pos_day_end_reports WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, reportId],
  );
  if (!result.rows[0]) throw posError(404, "POS day-end report was not found.", "POS_DAY_END_REPORT_NOT_FOUND");
  return result.rows[0];
}

// ---------------------------------------------------------------------
// Settlement evidence import + matching
// ---------------------------------------------------------------------

export async function importPosSettlementBatch(client, context, input = {}) {
  requirePermission(context, "pos.reconciliation.manage");
  const paymentMethod = String(input.paymentMethod || "").trim();
  if (!SETTLEMENT_PAYMENT_METHODS.includes(paymentMethod)) {
    throw posError(400, `paymentMethod must be one of ${SETTLEMENT_PAYMENT_METHODS.join(", ")}.`, "POS_SETTLEMENT_PAYMENT_METHOD_INVALID");
  }
  const providerKey = String(input.providerKey || "").trim();
  if (!providerKey) throw posError(400, "providerKey is required.", "POS_SETTLEMENT_PROVIDER_KEY_REQUIRED");
  const batchReference = String(input.batchReference || "").trim();
  if (!batchReference) throw posError(400, "batchReference is required.", "POS_SETTLEMENT_BATCH_REFERENCE_REQUIRED");
  const settlementDate = String(input.settlementDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(settlementDate)) throw posError(400, "settlementDate (YYYY-MM-DD) is required.", "POS_SETTLEMENT_DATE_REQUIRED");
  const entries = Array.isArray(input.entries) ? input.entries : [];
  if (!entries.length) throw posError(400, "At least one settlement entry is required.", "POS_SETTLEMENT_ENTRIES_REQUIRED");
  if (input.storeId) await assertPosStoreAccess(client, context, input.storeId);

  const existing = await client.query(
    `SELECT * FROM tenant.pos_settlement_batches WHERE organization_id=$1 AND company_id=$2 AND provider_key=$3 AND batch_reference=$4`,
    [context.organizationId, context.companyId, providerKey, batchReference],
  );
  if (existing.rows[0]) {
    const entryRows = await client.query(
      `SELECT * FROM tenant.pos_settlement_entries WHERE organization_id=$1 AND batch_id=$2 ORDER BY created_at`,
      [context.organizationId, existing.rows[0].id],
    );
    return { batch: existing.rows[0], entries: entryRows.rows, replayed: true };
  }

  const batchResult = await client.query(
    `INSERT INTO tenant.pos_settlement_batches
      (organization_id,company_id,store_id,payment_method,provider_key,batch_reference,settlement_date,imported_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [context.organizationId, context.companyId, input.storeId || null, paymentMethod, providerKey, batchReference, settlementDate, context.userId],
  );
  const batch = batchResult.rows[0];

  const seenReferences = new Set();
  let totalAmount = decimal(0);
  let totalFee = decimal(0);
  const insertedEntries = [];
  for (const raw of entries) {
    const providerReference = String(raw.providerReference || "").trim();
    if (!providerReference) throw posError(400, "Every settlement entry requires a providerReference.", "POS_SETTLEMENT_ENTRY_REFERENCE_REQUIRED");
    const amount = decimal(raw.amount || 0);
    if (amount <= 0n) throw posError(400, "Every settlement entry requires a positive amount.", "POS_SETTLEMENT_ENTRY_AMOUNT_INVALID");
    const feeAmount = decimal(raw.feeAmount || 0);
    const settledAt = raw.settledAt ? new Date(raw.settledAt) : new Date();

    let matchStatus = "unmatched";
    let matchedPaymentId = null;
    if (seenReferences.has(providerReference)) {
      matchStatus = "duplicate";
    } else {
      seenReferences.add(providerReference);
      const alreadyMatched = await client.query(
        `SELECT 1 FROM tenant.pos_settlement_entries WHERE organization_id=$1 AND provider_reference=$2 AND match_status='matched'`,
        [context.organizationId, providerReference],
      );
      if (alreadyMatched.rows[0]) {
        matchStatus = "duplicate";
      } else {
        const candidate = await client.query(
          `SELECT * FROM tenant.pos_payments
            WHERE organization_id=$1 AND company_id=$2 AND payment_method=$3 AND provider_reference=$4
              AND status IN ('captured','partially_refunded','refunded') AND settlement_entry_id IS NULL
            FOR UPDATE`,
          [context.organizationId, context.companyId, paymentMethod, providerReference],
        );
        if (candidate.rows[0]) {
          matchStatus = "matched";
          matchedPaymentId = candidate.rows[0].id;
        }
      }
    }

    const entryResult = await client.query(
      `INSERT INTO tenant.pos_settlement_entries
        (organization_id,company_id,batch_id,provider_reference,amount,fee_amount,settled_at,matched_payment_id,match_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [context.organizationId, context.companyId, batch.id, providerReference, asDatabaseDecimal(amount), asDatabaseDecimal(feeAmount), settledAt.toISOString(), matchedPaymentId, matchStatus],
    );
    insertedEntries.push(entryResult.rows[0]);

    if (matchStatus === "matched") {
      await client.query(
        `UPDATE tenant.pos_payments
           SET settlement_status='settled',settled_amount=$3,settlement_fee_amount=$4,settled_at=$5,settlement_entry_id=$6
         WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, matchedPaymentId, asDatabaseDecimal(amount), asDatabaseDecimal(feeAmount), settledAt.toISOString(), entryResult.rows[0].id],
      );
    }
    totalAmount = add(totalAmount, amount);
    totalFee = add(totalFee, feeAmount);
  }

  const updatedBatch = await client.query(
    `UPDATE tenant.pos_settlement_batches SET total_amount=$3,total_fee_amount=$4,entry_count=$5,status='matched'
     WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, batch.id, asDatabaseDecimal(totalAmount), asDatabaseDecimal(totalFee), insertedEntries.length],
  );
  await event(client, context, batch.id, "pos.settlement_batch.imported", {
    batchId: batch.id, entryCount: insertedEntries.length,
    matched: insertedEntries.filter((e) => e.match_status === "matched").length,
    unmatched: insertedEntries.filter((e) => e.match_status === "unmatched").length,
    duplicate: insertedEntries.filter((e) => e.match_status === "duplicate").length,
  });
  return { batch: updatedBatch.rows[0], entries: insertedEntries, replayed: false };
}

// ---------------------------------------------------------------------
// Reconciliation generation / resolution
// ---------------------------------------------------------------------

async function syncDayEndReportReconciliationStatus(client, context, reportId) {
  const rows = await client.query(
    `SELECT * FROM tenant.pos_reconciliations WHERE organization_id=$1 AND day_end_report_id=$2 ORDER BY payment_method`,
    [context.organizationId, reportId],
  );
  const reconciliationStatus = rows.rows.length === 0
    ? "pending"
    : rows.rows.every((row) => row.status === "matched" || row.status === "resolved")
      ? "matched"
      : "exception";
  const references = rows.rows.map((row) => ({ type: "pos_reconciliation", id: row.id, note: row.payment_method }));
  const exceptions = rows.rows
    .filter((row) => row.status === "variance")
    .map((row) => ({ paymentMethod: row.payment_method, varianceAmount: row.variance_amount, missingCount: row.missing_count, duplicateCount: row.duplicate_count }));
  await client.query(
    `UPDATE tenant.pos_day_end_reports
     SET reconciliation_status=$3,reconciliation_references=$4::jsonb,outstanding_exceptions=$5::jsonb,updated_at=now()
     WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, reportId, reconciliationStatus, JSON.stringify(references), JSON.stringify(exceptions)],
  );
}

export async function generatePosReconciliation(client, context, reportId, input = {}) {
  requirePermission(context, "pos.reconciliation.manage");
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "pos.reconciliation.generate",
    key: input.idempotencyKey,
    payload: { reportId },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };

  const report = await lockDayEndReport(client, context, reportId);
  await assertPosStoreAccess(client, context, report.store_id);
  if (report.status !== "closed") {
    throw posError(409, "Only a closed POS day-end report can be reconciled.", "POS_RECONCILIATION_REPORT_NOT_CLOSED");
  }
  const lineage = report.lineage && typeof report.lineage === "object" ? report.lineage : {};
  const shiftIds = Array.isArray(lineage.shiftIds) ? lineage.shiftIds : [];
  if (!shiftIds.length) throw posError(409, "This day-end report has no shifts to reconcile.", "POS_RECONCILIATION_NO_SHIFTS");

  const methodsResult = await client.query(
    `SELECT DISTINCT payment_method FROM tenant.pos_payments WHERE organization_id=$1 AND company_id=$2 AND shift_id=ANY($3::uuid[])`,
    [context.organizationId, context.companyId, shiftIds],
  );
  const methods = new Set(["cash", ...methodsResult.rows.map((row) => row.payment_method)]);

  const results = [];
  for (const method of methods) {
    const existing = await client.query(
      `SELECT * FROM tenant.pos_reconciliations WHERE organization_id=$1 AND day_end_report_id=$2 AND payment_method=$3 FOR UPDATE`,
      [context.organizationId, reportId, method],
    );
    if (existing.rows[0] && existing.rows[0].status === "resolved") {
      results.push(existing.rows[0]);
      continue;
    }

    let expectedAmount;
    let settledAmount;
    let feeTotal = decimal(0);
    let missingCount = 0;
    let duplicateCount = 0;
    let providerSettlementReference = null;

    if (method === "cash") {
      expectedAmount = decimal(report.expected_cash_total);
      settledAmount = report.counted_cash_total != null ? decimal(report.counted_cash_total) : expectedAmount;
    } else {
      const paymentAgg = await client.query(
        `SELECT coalesce(sum(amount),0)::text AS expected,coalesce(sum(settled_amount),0)::text AS settled,
                coalesce(sum(settlement_fee_amount),0)::text AS fee
           FROM tenant.pos_payments
          WHERE organization_id=$1 AND company_id=$2 AND shift_id=ANY($3::uuid[]) AND payment_method=$4
            AND status IN ('captured','partially_refunded','refunded')`,
        [context.organizationId, context.companyId, shiftIds, method],
      );
      expectedAmount = decimal(paymentAgg.rows[0].expected);
      settledAmount = decimal(paymentAgg.rows[0].settled);
      feeTotal = decimal(paymentAgg.rows[0].fee);

      const exceptionAgg = await client.query(
        `SELECT
           count(*) FILTER (WHERE entry.match_status='unmatched')::int AS missing_count,
           count(*) FILTER (WHERE entry.match_status='duplicate')::int AS duplicate_count
         FROM tenant.pos_settlement_entries entry
         JOIN tenant.pos_settlement_batches batch
           ON batch.organization_id=entry.organization_id AND batch.id=entry.batch_id
        WHERE entry.organization_id=$1 AND entry.company_id=$2 AND batch.payment_method=$3
          AND batch.settlement_date=$4 AND (batch.store_id IS NULL OR batch.store_id=$5)`,
        [context.organizationId, context.companyId, method, report.business_date, report.store_id],
      );
      missingCount = exceptionAgg.rows[0].missing_count;
      duplicateCount = exceptionAgg.rows[0].duplicate_count;
    }

    const varianceAmount = sub(settledAmount, expectedAmount);
    const status = varianceAmount === 0n && missingCount === 0 && duplicateCount === 0 ? "matched" : "variance";

    let row;
    if (existing.rows[0]) {
      const updated = await client.query(
        `UPDATE tenant.pos_reconciliations
         SET expected_amount=$3,counted_amount=$4,variance_amount=$5,settled_amount=$4,fee_total=$6,
             missing_count=$7,duplicate_count=$8,status=$9,matched_by=$10,matched_at=now(),
             provider_settlement_reference=$11,updated_at=now()
         WHERE organization_id=$1 AND id=$2 RETURNING *`,
        [context.organizationId, existing.rows[0].id, asDatabaseDecimal(expectedAmount), asDatabaseDecimal(settledAmount),
          asDatabaseDecimal(varianceAmount), asDatabaseDecimal(feeTotal), missingCount, duplicateCount, status,
          context.userId, providerSettlementReference],
      );
      row = updated.rows[0];
    } else {
      const reconciliationNumber = await nextDocumentNumber(client, context, {
        documentType: "pos_reconciliation",
        prefix: "RECN",
        periodKey: `${report.store_id}:${reportId}:${method}`,
        padding: 4,
      });
      const inserted = await client.query(
        `INSERT INTO tenant.pos_reconciliations
          (organization_id,company_id,store_id,day_end_report_id,shift_id,payment_method,reconciliation_number,
           expected_amount,counted_amount,variance_amount,settled_amount,fee_total,missing_count,duplicate_count,
           status,matched_by,matched_at,provider_settlement_reference)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$9,$11,$12,$13,$14,$15,now(),$16)
         RETURNING *`,
        [context.organizationId, context.companyId, report.store_id, reportId,
          report.scope_type === "shift" ? report.shift_id : null, method, reconciliationNumber,
          asDatabaseDecimal(expectedAmount), asDatabaseDecimal(settledAmount), asDatabaseDecimal(varianceAmount),
          asDatabaseDecimal(feeTotal), missingCount, duplicateCount, status, context.userId, providerSettlementReference],
      );
      row = inserted.rows[0];
    }
    await event(client, context, row.id, "pos.reconciliation.generated", { paymentMethod: method, status, varianceAmount: asDatabaseDecimal(varianceAmount) });
    results.push(row);
  }

  await syncDayEndReportReconciliationStatus(client, context, reportId);

  const response = { reportId, reconciliations: results, replayed: false };
  await completeIdempotentOperation(client, context, idempotency, {
    response, aggregateType: "pos_day_end_report", aggregateId: reportId,
  });
  return response;
}

async function lockReconciliation(client, context, reconciliationId) {
  const result = await client.query(
    `SELECT * FROM tenant.pos_reconciliations WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, reconciliationId],
  );
  if (!result.rows[0]) throw posError(404, "POS reconciliation was not found.", "POS_RECONCILIATION_NOT_FOUND");
  return result.rows[0];
}

export async function resolvePosReconciliation(client, context, reconciliationId, input = {}) {
  requirePermission(context, "pos.reconciliation.approve");
  const reconciliation = await lockReconciliation(client, context, reconciliationId);
  await assertPosStoreAccess(client, context, reconciliation.store_id);
  if (reconciliation.status === "resolved") return { ...reconciliation, replayed: true };
  if (reconciliation.status !== "variance") {
    throw posError(409, "Only a reconciliation with an unresolved variance can be resolved.", "POS_RECONCILIATION_STATE_INVALID");
  }
  // Maker-checker: the role that matched/generated this reconciliation
  // must differ from the role that resolves its variance (see the
  // pos_reconciliation_manage_approve SoD conflict) — mirrors the exact
  // pattern F303's finalizePosDayEndReport already established.
  if (reconciliation.matched_by === context.userId) {
    throw posError(409, "The person who generated this reconciliation cannot also resolve its variance.", "POS_RECONCILIATION_SELF_RESOLVE_BLOCKED");
  }
  if (!input.resolutionNotes || !String(input.resolutionNotes).trim()) {
    throw posError(400, "resolutionNotes is required to resolve a reconciliation variance.", "POS_RECONCILIATION_NOTES_REQUIRED");
  }
  const updated = await client.query(
    `UPDATE tenant.pos_reconciliations
     SET status='resolved',resolved_by=$3,resolved_at=now(),resolution_notes=$4,approved_by=$3,approved_at=now(),updated_at=now()
     WHERE organization_id=$1 AND id=$2 AND status='variance'
     RETURNING *`,
    [context.organizationId, reconciliationId, context.userId, String(input.resolutionNotes).trim()],
  );
  if (!updated.rows[0]) throw posError(409, "This reconciliation changed state concurrently. Retry.", "POS_RECONCILIATION_STATE_CONFLICT");
  await event(client, context, reconciliationId, "pos.reconciliation.resolved", { resolutionNotes: input.resolutionNotes });
  if (reconciliation.day_end_report_id) {
    await syncDayEndReportReconciliationStatus(client, context, reconciliation.day_end_report_id);
  }
  return { ...updated.rows[0], replayed: false };
}

export async function recordPosReconciliationCorrection(client, context, reconciliationId, input = {}) {
  requirePermission(context, "pos.reconciliation.approve");
  const reconciliation = await lockReconciliation(client, context, reconciliationId);
  await assertPosStoreAccess(client, context, reconciliation.store_id);
  if (reconciliation.status !== "resolved") {
    throw posError(409, "Only a resolved POS reconciliation can receive a linked correction.", "POS_RECONCILIATION_STATE_INVALID");
  }
  if (!input.reason || !String(input.reason).trim()) {
    throw posError(400, "A reason is required to record a reconciliation correction.", "POS_RECONCILIATION_CORRECTION_REASON_REQUIRED");
  }
  const correctionNumber = await nextDocumentNumber(client, context, {
    documentType: "pos_reconciliation_correction",
    prefix: "RCORR",
    periodKey: reconciliationId,
    padding: 4,
  });
  const inserted = await client.query(
    `INSERT INTO tenant.pos_reconciliation_corrections
      (organization_id,company_id,reconciliation_id,correction_number,reason,adjustment,created_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
     RETURNING *`,
    [context.organizationId, context.companyId, reconciliationId, correctionNumber, String(input.reason).trim(), JSON.stringify(input.adjustment || []), context.userId],
  );
  await event(client, context, reconciliationId, "pos.reconciliation.correction_recorded", { correctionId: inserted.rows[0].id });
  return inserted.rows[0];
}

export async function listPosReconciliations(client, context, options = {}) {
  requirePermission(context, "pos.reconciliation.view");
  const values = [context.organizationId, context.companyId];
  const clauses = [];
  if (options.storeId) {
    values.push(options.storeId);
    clauses.push(`store_id=$${values.length}`);
  }
  if (options.dayEndReportId) {
    values.push(options.dayEndReportId);
    clauses.push(`day_end_report_id=$${values.length}`);
  }
  if (options.status) {
    values.push(options.status);
    clauses.push(`status=$${values.length}`);
  }
  values.push(Math.min(Number(options.limit) || 100, 200), Number(options.offset) || 0);
  const result = await client.query(
    `SELECT * FROM tenant.pos_reconciliations
     WHERE organization_id=$1 AND company_id=$2 ${clauses.map((c) => `AND ${c}`).join(" ")}
     ORDER BY created_at DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return result.rows;
}

export async function getPosReconciliation(client, context, reconciliationId) {
  requirePermission(context, "pos.reconciliation.view");
  const result = await client.query(
    `SELECT * FROM tenant.pos_reconciliations WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [context.organizationId, context.companyId, reconciliationId],
  );
  const row = result.rows[0];
  if (!row) throw posError(404, "POS reconciliation was not found.", "POS_RECONCILIATION_NOT_FOUND");
  await assertPosStoreAccess(client, context, row.store_id);
  const corrections = await client.query(
    `SELECT * FROM tenant.pos_reconciliation_corrections WHERE organization_id=$1 AND reconciliation_id=$2 ORDER BY created_at`,
    [context.organizationId, reconciliationId],
  );
  return { ...row, corrections: corrections.rows };
}
