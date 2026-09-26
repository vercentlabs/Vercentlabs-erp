// Server-side lookups for Accounting approval and set-up actions.
const APPROVABLE = Object.freeze({
  journal: "accounting_journal_entries",
  invoice: "accounting_customer_invoices",
  bill: "accounting_vendor_bills",
  payment: "accounting_vendor_payments",
});

// An approver acts on a specific row in the list, not on a hash they typed
// in: the current stored content hash is looked up here, and the domain
// approval still refuses it if the document's content no longer matches.
export async function accountingDocumentContentHash(client, organizationId, documentType, id) {
  const table = APPROVABLE[documentType];
  if (!table) throw new TypeError(`accountingDocumentContentHash: unsupported document type ${documentType}`);
  const result = await client.query(`SELECT content_hash FROM tenant.${table} WHERE organization_id=$1 AND id=$2`, [organizationId, id]);
  return result.rows[0]?.content_hash ? String(result.rows[0].content_hash) : "";
}

// The company's active primary ledger (null when it has none).
export async function primaryAccountingLedgerId(client, organizationId, companyId) {
  const result = await client.query(
    `SELECT id FROM tenant.accounting_ledgers WHERE organization_id=$1 AND company_id=$2 AND ledger_type='primary' AND status='active' LIMIT 1`,
    [organizationId, companyId],
  );
  return result.rows[0]?.id ? String(result.rows[0].id) : null;
}
