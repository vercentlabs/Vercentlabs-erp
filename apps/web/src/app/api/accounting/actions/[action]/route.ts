import { z } from "zod";

import {
  activateBudget, approveBudget, approveCustomerInvoice, approveJournalEntry, approveVendorBill, approveVendorPayment, allocateCustomerReceipt, allocateVendorPayment,
  applyCustomerCreditNote, applyVendorCreditNote, calculateRevaluation, capitalizeAsset, completeBankReconciliation, completeCloseRun, createAccountingAccount,
  createAccrualSchedule, createAsset, createAssetCategory, createBankAccount, createBudget, createCloseRun, createCustomerInvoice, createCustomerReceipt,
  createJournalEntry, createRecurringTemplate, createTaxReturn, createVendorBill, createVendorPayment, disposeAsset, importBankStatement,
  matchBankStatementLine, postAssetDepreciation, postCustomerInvoice, postCustomerReceipt, postJournalEntry, postRevaluation, postVendorBill, postVendorPayment,
  rejectBudgetApproval, rejectCustomerInvoiceApproval, rejectJournalApproval, rejectVendorBillApproval, rejectVendorPaymentApproval, reverseJournalEntry,
  runDueAccruals, runDueRecurringTemplates, startBankReconciliation, submitBudget, submitCustomerInvoice, submitJournalEntry, submitVendorBill, submitVendorPayment,
  updateAccountingSettings, updateCloseTask, updateFiscalPeriodStatus, updateTaxReturnStatus, accountingDocumentContentHash, primaryAccountingLedgerId,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { accountingMutation } from "@/features/accounting/shared/route-helpers";

const body = z.record(z.string(), z.unknown());
const str = (input: Record<string, unknown>, key: string) => String(input[key] ?? "");
// An approver acts on a specific row in the list, not on a hash they typed in: the current stored content hash is
// looked up server-side, and the domain function still refuses it if the document's content no longer matches that hash.
const APPROVAL_DOCUMENTS: Record<string, "journal" | "invoice" | "bill" | "payment"> = { "journal-approve": "journal", "invoice-approve": "invoice", "bill-approve": "bill", "payment-approve": "payment" };
const idOf = (input: Record<string, unknown>) => {
  const id = str(input, "id");
  if (!id) throw new HttpError(400, "A record id is required.");
  return id;
};

// One mutation endpoint per Accounting operation. Each domain function enforces its OWN permission, state
// machine and segregation of duties (a submitter can never approve their own document).
export async function POST(request: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  return accountingMutation(
    request,
    body,
    async (client, context, rawInput) => {
      // Every document is created in the session's active company; a company id in the body is never trusted.
      const input: Record<string, unknown> = { ...rawInput, companyId: context.activeCompanyId };
      if (APPROVAL_DOCUMENTS[action] && !input.contentHash) {
        input.contentHash = await accountingDocumentContentHash(client, context.organizationId, APPROVAL_DOCUMENTS[action], idOf(input));
      }
      switch (action) {
        case "settings-save":
          return { record: await updateAccountingSettings(client, context, input) };
        case "account-create": {
          const ledgerId = await primaryAccountingLedgerId(client, context.organizationId, context.activeCompanyId);
          if (!ledgerId) throw new HttpError(409, "This company has no active primary ledger.");
          return { record: await createAccountingAccount(client, context, { ledgerId, ...input }) };
        }
        case "journal-create":
          return { record: await createJournalEntry(client, context, input) };
        case "journal-submit":
          return { record: await submitJournalEntry(client, context, idOf(input)) };
        case "journal-approve":
          return { record: await approveJournalEntry(client, context, idOf(input), str(input, "contentHash")) };
        case "journal-reject":
          return { record: await rejectJournalApproval(client, context, idOf(input)) };
        case "journal-post":
          return { record: await postJournalEntry(client, context, idOf(input)) };
        case "journal-reverse":
          return { record: await reverseJournalEntry(client, context, idOf(input), { reason: str(input, "reason") }) };
        case "invoice-create":
          return { record: await createCustomerInvoice(client, context, input) };
        case "invoice-submit":
          return { record: await submitCustomerInvoice(client, context, idOf(input)) };
        case "invoice-approve":
          return { record: await approveCustomerInvoice(client, context, idOf(input), str(input, "contentHash")) };
        case "invoice-reject":
          return { record: await rejectCustomerInvoiceApproval(client, context, idOf(input)) };
        case "invoice-post":
          return { record: await postCustomerInvoice(client, context, idOf(input)) };
        case "credit-note-apply":
          return { record: await applyCustomerCreditNote(client, context, idOf(input), input) };
        case "receipt-create":
          return { record: await createCustomerReceipt(client, context, input) };
        case "receipt-post":
          return { record: await postCustomerReceipt(client, context, idOf(input)) };
        case "receipt-allocate":
          return { record: await allocateCustomerReceipt(client, context, idOf(input), input) };
        case "bill-create":
          return { record: await createVendorBill(client, context, input) };
        case "bill-submit":
          return { record: await submitVendorBill(client, context, idOf(input)) };
        case "bill-approve":
          return { record: await approveVendorBill(client, context, idOf(input), str(input, "contentHash")) };
        case "bill-reject":
          return { record: await rejectVendorBillApproval(client, context, idOf(input)) };
        case "bill-post":
          return { record: await postVendorBill(client, context, idOf(input)) };
        case "vendor-credit-apply":
          return { record: await applyVendorCreditNote(client, context, idOf(input), input) };
        case "payment-create":
          return { record: await createVendorPayment(client, context, input) };
        case "payment-submit":
          return { record: await submitVendorPayment(client, context, idOf(input)) };
        case "payment-approve":
          return { record: await approveVendorPayment(client, context, idOf(input), str(input, "contentHash")) };
        case "payment-reject":
          return { record: await rejectVendorPaymentApproval(client, context, idOf(input)) };
        case "payment-post":
          return { record: await postVendorPayment(client, context, idOf(input)) };
        case "payment-allocate":
          return { record: await allocateVendorPayment(client, context, idOf(input), input) };
        case "bank-account-create":
          return { record: await createBankAccount(client, context, input) };
        case "statement-import":
          return { record: await importBankStatement(client, context, input) };
        case "reconciliation-start":
          return { record: await startBankReconciliation(client, context, input) };
        case "reconciliation-match":
          return { record: await matchBankStatementLine(client, context, str(input, "reconciliationId"), input) };
        case "reconciliation-complete":
          return { record: await completeBankReconciliation(client, context, idOf(input)) };
        case "tax-return-create":
          return { record: await createTaxReturn(client, context, input) };
        case "tax-return-status":
          return { record: await updateTaxReturnStatus(client, context, idOf(input), input) };
        case "budget-create":
          return { record: await createBudget(client, context, input) };
        case "budget-submit":
          return { record: await submitBudget(client, context, idOf(input)) };
        case "budget-approve":
          return { record: await approveBudget(client, context, idOf(input)) };
        case "budget-reject":
          return { record: await rejectBudgetApproval(client, context, idOf(input)) };
        case "budget-activate":
          return { record: await activateBudget(client, context, idOf(input)) };
        case "recurring-create":
          return { record: await createRecurringTemplate(client, context, input) };
        case "recurring-run":
          return { record: await runDueRecurringTemplates(client, context, str(input, "runDate") || null) };
        case "accrual-create":
          return { record: await createAccrualSchedule(client, context, input) };
        case "accrual-run":
          return { record: await runDueAccruals(client, context, input) };
        case "revaluation-calculate":
          return { record: await calculateRevaluation(client, context, input) };
        case "revaluation-post":
          return { record: await postRevaluation(client, context, idOf(input)) };
        case "asset-category-create":
          return { record: await createAssetCategory(client, context, input) };
        case "asset-create":
          return { record: await createAsset(client, context, input) };
        case "asset-capitalize":
          return { record: await capitalizeAsset(client, context, idOf(input), input) };
        case "asset-depreciate":
          return { record: await postAssetDepreciation(client, context, idOf(input)) };
        case "asset-dispose":
          return { record: await disposeAsset(client, context, idOf(input), input) };
        case "period-status":
          return { record: await updateFiscalPeriodStatus(client, context, idOf(input), input) };
        case "close-run-create":
          return { record: await createCloseRun(client, context, input) };
        case "close-task-update":
          return { record: await updateCloseTask(client, context, str(input, "runId"), str(input, "taskId"), input) };
        case "close-run-complete":
          return { record: await completeCloseRun(client, context, idOf(input), input) };
        default:
          throw new HttpError(404, "Unknown Accounting action.");
      }
    },
    200,
    "accounting.view",
  );
}
