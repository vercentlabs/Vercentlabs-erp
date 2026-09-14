import { ProcurementError, runProcurementMatch } from "../modules/procurement/index.js";
import { importProcurementMatchAsVendorBill } from "../modules/accounting/index.js";

// F084/F085/F086 gap: a clean Procurement invoice match only ever wrote a
// procurement.vendor-bill.ready outbox event, and nothing anywhere consumes
// tenant.procurement_outbox (confirmed by a repo-wide grep -- no worker
// handler, no orchestration function reads it). A matched supplier invoice
// therefore never produced a real Accounting payable, even though Accounting
// already had a real, idempotent importProcurementMatchAsVendorBill()
// function (services/api/src/modules/accounting/payables.js) sitting
// unused for exactly this purpose. This closes that gap by calling it
// directly from the same request that runs the match, instead of routing
// through the dead outbox.
//
// Best-effort, not strict: a clean match is itself complete, real,
// auditable Procurement truth (the matching_records ledger row is
// permanent) whether or not the Accounting import succeeds immediately
// afterward. The one precondition importProcurementMatchAsVendorBill
// itself enforces -- the supplier must be linked to an Accounting business
// partner (accountingPartyId) -- is not always going to be true yet, and a
// missing link should not make an otherwise-successful match look like a
// failure. If the import does run but fails for a different reason (e.g. a
// mid-flight Accounting validation error), that DOES propagate, since a
// half-completed Accounting posting would be worse than an explicit retry.
export async function runProcurementMatchWithVendorBillImport(
  client,
  procurementContext,
  accountingContext,
  input = {},
) {
  if (procurementContext.organizationId !== accountingContext.organizationId) {
    throw new ProcurementError(
      403,
      "Procurement and Accounting organization context must match.",
      "PROCUREMENT_ACCOUNTING_CONTEXT_INVALID",
    );
  }

  const result = await runProcurementMatch(client, procurementContext, input);
  const matchingRecord = result?.matchingRecord;
  if (!matchingRecord || matchingRecord.status !== "matched") {
    // A match with exceptions needs human resolution/override before any
    // financial posting -- see F085/F086's own exception-first design.
    return { ...result, vendorBill: null };
  }

  const supplier = await client.query(
    `SELECT data->>'accountingPartyId' AS party_id FROM tenant.procurement_suppliers WHERE organization_id=$1 AND id=$2`,
    [procurementContext.organizationId, matchingRecord.supplierId],
  );
  const partyId = supplier.rows[0]?.party_id || null;
  if (!partyId) {
    return {
      ...result,
      vendorBill: null,
      vendorBillSkippedReason: "PROCUREMENT_SUPPLIER_NOT_LINKED_TO_ACCOUNTING_PARTY",
    };
  }

  // importProcurementMatchAsVendorBill returns getVendorBill()'s composite
  // { bill, lines, schedules, allocations, events } detail shape, not a flat
  // bill row -- unwrapped here so this wrapper's own `vendorBill` field is
  // what its name promises (found the hard way: a real browser E2E run
  // sent `vendorBill.id` -- always undefined -- to the bill-actions route).
  const vendorBillDetail = await importProcurementMatchAsVendorBill(
    client,
    accountingContext,
    matchingRecord.id,
    { partyId },
  );
  return { ...result, vendorBill: vendorBillDetail.bill, vendorBillDetail };
}
