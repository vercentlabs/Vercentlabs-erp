import { ACCOUNTING_PERMISSIONS } from "@vercentlabs/permissions";

// F290/F305: every call this module makes into Accounting's public
// contract (services/api/src/modules/accounting/index.js) passes
// { internal: true } at the entry point it calls -- createCustomerInvoice/
// createJournalEntry/postJournalEntry already supported this before POS
// existed; submitSubledgerDocument/postCustomerInvoice were extended this
// pass to match that exact precedent (see subledger-approvals.js/
// receivables.js). That bypasses the INTERACTIVE permission gate at each
// entry point, but a couple of read-only helpers those functions call
// internally (getCustomerInvoice, in particular) have no internal bypass
// of their own -- they are ordinary permission-gated queries. This context
// carries the accounting.view/receivables.manage permissions those nested
// reads need, scoped to exactly one server-side call chain that already
// passed POS's own authorization (assertPosStoreAccess/requirePermission);
// it is never derived from end-user input and is never returned to a
// client.
// F290/F305/F305-config: settingsManage is needed by the account-mapping
// configuration wrapper (accounting-mapping-config.js) -- upsertAccountMapping
// has no internal bypass of its own (unlike createJournalEntry/
// createCustomerInvoice), so it's satisfied the same way receivablesManage
// is here: the REAL gate is POS's own pos.settings.manage permission check
// at the wrapper's entry point (accountingPost-tier, already required
// before this context is ever built), not a second interactive Accounting
// permission the POS admin configuring a mapping would have to separately
// hold.
export function posAccountingContext(context) {
  return {
    ...context,
    activeCompanyId: context.companyId,
    allowAllCompanies: false,
    permissions: [
      ...(context.permissions || []),
      ACCOUNTING_PERMISSIONS.view,
      ACCOUNTING_PERMISSIONS.receivablesManage,
      ACCOUNTING_PERMISSIONS.settingsManage,
    ],
  };
}
