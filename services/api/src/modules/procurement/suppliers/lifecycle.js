// Whether a supplier may be used.
//
//   Active    selectable on RFQs and purchase orders.
//   Inactive  not for new business. Everything it was used on stays as it was.
//   Blocked   a commercial or compliance hold, with a reason, who and when.
//             It stops new purchase orders; it does not undo goods already
//             received, and it does not stop Finance paying what is owed:
//             holding a payment is Accounts Payable's decision.
//
// Each change is its own action with its own permission, never a status
// field anyone can edit. A supplier is deleted only if it was created by
// mistake and never used anywhere.
import { SUPPLIER_PERMISSIONS, SUPPLIER_STATUS, SupplierError, text } from "./constants.js";
import { loadSupplier, recordSupplierEvent, requireSupplierPermission } from "./access.js";
import { getSupplier } from "./records.js";

async function setStatus(client, context, supplier, status, reason, eventType, summary) {
  await client.query(
    `UPDATE tenant.procurement_suppliers
        SET status = $3, status_reason = $4, status_changed_at = now(), status_changed_by = $5,
            blocked_reason = CASE WHEN $3 = 'blocked' THEN $4 ELSE NULL END, blocked_by = CASE WHEN $3 = 'blocked' THEN $5::uuid ELSE NULL END,
            blocked_at = CASE WHEN $3 = 'blocked' THEN now() ELSE NULL END, version = version + 1, updated_by = $5, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, supplier.id, status, reason, context.userId ?? null]);
  await recordSupplierEvent(client, context, supplier.id, eventType, summary, { from: supplier.status, to: status, reason });
  return getSupplier(client, context, supplier.id);
}

export async function deactivateSupplier(client, context, supplierId, input = {}) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.status, "You do not have permission to deactivate suppliers.");
  const supplier = await loadSupplier(client, context, supplierId, { lock: true });
  if (supplier.status !== SUPPLIER_STATUS.active)
    throw new SupplierError(409, `${supplier.supplier_number} is ${supplier.status}; only an active supplier is deactivated.`, "SUPPLIER_INVALID_TRANSITION");
  const reason = text(input.reason, 1000);
  return setStatus(client, context, supplier, SUPPLIER_STATUS.inactive, reason, "supplier.deactivated", `Deactivated${reason ? `: ${reason}` : ""}`);
}

export async function activateSupplier(client, context, supplierId, input = {}) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.status, "You do not have permission to activate suppliers.");
  const supplier = await loadSupplier(client, context, supplierId, { lock: true });
  if (supplier.status === SUPPLIER_STATUS.blocked) throw new SupplierError(409, "A blocked supplier is unblocked, not activated.", "SUPPLIER_INVALID_TRANSITION");
  if (supplier.status !== SUPPLIER_STATUS.inactive) throw new SupplierError(409, `${supplier.supplier_number} is already active.`, "SUPPLIER_INVALID_TRANSITION");
  const reason = text(input.reason, 1000);
  return setStatus(client, context, supplier, SUPPLIER_STATUS.active, reason, "supplier.activated", `Activated${reason ? `: ${reason}` : ""}`);
}

// input: reason (required): quality dispute, fraud concern, contract issue, management hold...
export async function blockSupplier(client, context, supplierId, input = {}) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.block, "You do not have permission to block suppliers.");
  const supplier = await loadSupplier(client, context, supplierId, { lock: true });
  if (supplier.status === SUPPLIER_STATUS.blocked) throw new SupplierError(409, `${supplier.supplier_number} is already blocked.`, "SUPPLIER_INVALID_TRANSITION");
  const reason = text(input.reason, 1000);
  if (!reason || reason.length < 3)
    throw new SupplierError(400, "Say why the supplier is blocked.", "SUPPLIER_BLOCK_REASON_REQUIRED", { issues: [{ field: "reason", message: "Enter the reason." }] });
  return setStatus(client, context, supplier, SUPPLIER_STATUS.blocked, reason, "supplier.blocked", `Blocked: ${reason}`);
}

// An unblocked supplier is active again, unless the caller says it should stay out of use (inactive).
export async function unblockSupplier(client, context, supplierId, input = {}) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.block, "You do not have permission to unblock suppliers.");
  const supplier = await loadSupplier(client, context, supplierId, { lock: true });
  if (supplier.status !== SUPPLIER_STATUS.blocked) throw new SupplierError(409, `${supplier.supplier_number} is not blocked.`, "SUPPLIER_INVALID_TRANSITION");
  const reason = text(input.reason, 1000);
  if (!reason || reason.length < 3)
    throw new SupplierError(400, "Say why the block is lifted.", "SUPPLIER_UNBLOCK_REASON_REQUIRED", { issues: [{ field: "reason", message: "Enter the reason." }] });
  const status = input.inactive === true ? SUPPLIER_STATUS.inactive : SUPPLIER_STATUS.active;
  return setStatus(client, context, supplier, status, reason, "supplier.unblocked", `Unblocked${status === SUPPLIER_STATUS.inactive ? " (left inactive)" : ""}: ${reason}`);
}

// Every place a supplier can be used: procurement documents, other modules' records, and Accounts Payable through its party.
const USES = Object.freeze([
  ["procurement_purchase_orders", "supplier_id", "purchase orders"], ["procurement_receipts", "supplier_id", "goods receipts"], ["procurement_returns", "supplier_id", "purchase returns"],
  ["procurement_invoice_matches", "supplier_id", "invoice matches"], ["procurement_match_exceptions", "supplier_id", "match exceptions"],
  ["procurement_agreements", "supplier_id", "agreements"], ["procurement_service_entries", "supplier_id", "service entries"], ["procurement_sourcing_awards", "supplier_id", "RFQ awards"],
  ["procurement_subcontract_orders", "supplier_id", "subcontract orders"], ["procurement_reorder_requests", "supplier_id", "reorder requests"],
  ["procurement_supplier_prices", "supplier_id", "supplier prices"], ["procurement_supplier_lead_times", "supplier_id", "lead times"],
  ["procurement_supplier_sites", "parent_id", "sites"], ["procurement_supplier_certifications", "parent_id", "certifications"],
  ["procurement_supplier_qualifications", "parent_id", "qualifications"], ["procurement_supplier_scorecards", "parent_id", "scorecards"],
  ["assets", "supplier_id", "assets"], ["asset_maintenance_orders", "supplier_id", "maintenance orders"], ["asset_maintenance_plans", "supplier_id", "maintenance plans"],
  ["asset_warranties", "supplier_id", "warranties"], ["project_expenses", "supplier_id", "project expenses"], ["quality_inspections", "supplier_id", "quality inspections"],
  ["quality_nonconformances", "supplier_id", "nonconformances"], ["quality_plans", "supplier_id", "quality plans"], ["quality_supplier_records", "supplier_id", "quality records"],
  ["sales_drop_ship_requests", "supplier_id", "drop-ship requests"], ["accounting_supplier_bank_accounts", "supplier_id", "payment details"],
]);
const PARTY_USES = Object.freeze([["accounting_vendor_bills", "supplier bills"], ["accounting_vendor_payments", "supplier payments"]]);

export async function supplierUses(client, context, supplier) {
  const found = [];
  // Assets, quality, projects and drop-ship records name the supplier by its party; procurement documents by the supplier role.
  for (const [table, column, label] of USES) {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM tenant.${table} WHERE organization_id = $1 AND ${column} = ANY($2::uuid[])`,
      [context.organizationId, [supplier.id, supplier.party_id]]);
    if (rows[0].n) found.push(`${rows[0].n} ${label}`);
  }
  for (const [table, label] of PARTY_USES) {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM tenant.${table} WHERE organization_id = $1 AND party_id = $2`, [context.organizationId, supplier.party_id]);
    if (rows[0].n) found.push(`${rows[0].n} ${label}`);
  }
  return found;
}

// Only a supplier created by mistake and never used is deleted; a used one is made inactive or blocked instead.
// The company identity goes with it only when nothing else (a customer, an account, a contact, a document) uses it.
export async function deleteSupplier(client, context, supplierId) {
  requireSupplierPermission(context, SUPPLIER_PERMISSIONS.status, "You do not have permission to delete suppliers.");
  const supplier = await loadSupplier(client, context, supplierId, { lock: true });
  const uses = await supplierUses(client, context, supplier);
  if (uses.length)
    throw new SupplierError(409, `${supplier.supplier_number} has been used (${uses.join(", ")}). Deactivate or block it instead.`, "SUPPLIER_IN_USE", { uses });
  const contacts = (await client.query(`SELECT contact_id FROM tenant.procurement_supplier_contacts WHERE organization_id = $1 AND supplier_id = $2`,
    [context.organizationId, supplier.id])).rows.map((row) => row.contact_id);
  for (const table of ["procurement_supplier_defaults", "procurement_supplier_contacts", "procurement_supplier_addresses", "procurement_supplier_tax_registrations", "procurement_supplier_events"])
    await client.query(`DELETE FROM tenant.${table} WHERE organization_id = $1 AND supplier_id = $2`, [context.organizationId, supplier.id]);
  await client.query(`DELETE FROM public.attachments WHERE organization_id = $1 AND entity_type = 'procurement.supplier' AND entity_id = $2`, [context.organizationId, supplier.id]);
  await client.query(`DELETE FROM tenant.procurement_suppliers WHERE organization_id = $1 AND id = $2`, [context.organizationId, supplier.id]);
  let partyRemoved = false;
  if (supplier.party_type === "supplier" && !supplier.customer_number) {
    await client.query("SAVEPOINT supplier_party_delete");
    try {
      if (contacts.length) await client.query(`DELETE FROM tenant.contacts WHERE organization_id = $1 AND id = ANY($2::uuid[]) AND party_id = $3`, [context.organizationId, contacts, supplier.party_id]);
      await client.query(`DELETE FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`, [context.organizationId, supplier.party_id]);
      await client.query("RELEASE SAVEPOINT supplier_party_delete");
      partyRemoved = true;
    } catch (error) {
      // Something else refers to the company (or its people): it stays, only the supplier role is gone.
      if (!error?.code?.startsWith?.("23")) throw error;
      await client.query("ROLLBACK TO SAVEPOINT supplier_party_delete");
    }
  } else {
    await client.query(`UPDATE tenant.business_parties SET party_type = 'customer', updated_at = now() WHERE organization_id = $1 AND id = $2 AND party_type = 'both'`,
      [context.organizationId, supplier.party_id]);
  }
  return { deleted: true, supplierNumber: supplier.supplier_number, partyRemoved };
}
