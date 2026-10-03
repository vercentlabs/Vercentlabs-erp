import { z } from "zod";

import {
  approveCustomerInvoice,
  approveJournalEntry,
  approveVendorBill,
  approveVendorPayment,
  allocateCustomerReceipt,
  allocateVendorPayment,
  applyCustomerCreditNote,
  applyVendorCreditNote,
  completeBankReconciliation,
  createAccountingAccount,
  createBankAccount,
  createCustomerInvoice,
  createCustomerReceipt,
  createJournalEntry,
  createVendorBill,
  createVendorPayment,
  importBankStatement,
  matchBankStatementLine,
  postCustomerInvoice,
  postCustomerReceipt,
  postJournalEntry,
  postVendorBill,
  postVendorPayment,
  rejectCustomerInvoiceApproval,
  rejectJournalApproval,
  rejectVendorBillApproval,
  rejectVendorPaymentApproval,
  reverseJournalEntry,
  startBankReconciliation,
  submitCustomerInvoice,
  submitJournalEntry,
  submitVendorBill,
  submitVendorPayment,
  updateAccountingSettings,
  updateFiscalPeriodStatus,
  accountingDocumentContentHash,
  primaryAccountingLedgerId,
  createCloseRun,
  updateCloseTask,
  completeCloseRun,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { accountingMutation } from "@/features/accounting/shared/route-helpers";

const body = z.record(z.string(), z.unknown());
const str = (input: Record<string, unknown>, key: string) =>
  String(input[key] ?? "");
// An approver acts on a specific row in the list, not on a hash they typed in: the current stored content hash is
// looked up server-side, and the domain function still refuses it if the document's content no longer matches that hash.
const APPROVAL_DOCUMENTS: Record<
  string,
  "journal" | "invoice" | "bill" | "payment"
> = {
  "journal-approve": "journal",
  "invoice-approve": "invoice",
  "bill-approve": "bill",
  "payment-approve": "payment",
};
const idOf = (input: Record<string, unknown>) => {
  const id = str(input, "id");
  if (!id) throw new HttpError(400, "A record id is required.");
  return id;
};

// One mutation endpoint per Accounting operation. Each domain function enforces its OWN permission, state
// machine and segregation of duties (a submitter can never approve their own document).
export async function POST(
  request: Request,
  ctx: { params: Promise<{ action: string }> },
) {
  const { action } = await ctx.params;
  return accountingMutation(
    request,
    body,
    async (client, context, rawInput) => {
      const input: Record<string, unknown> = { ...rawInput };
      if (APPROVAL_DOCUMENTS[action] && !input.contentHash) {
        input.contentHash = await accountingDocumentContentHash(
          client,
          context.organizationId,
          APPROVAL_DOCUMENTS[action],
          idOf(input),
        );
      }
      switch (action) {
        case "settings-save":
          return {
            record: await updateAccountingSettings(client, context, input),
          };
        case "account-create": {
          const ledgerId = await primaryAccountingLedgerId(
            client,
            context.organizationId,
          );
          if (!ledgerId)
            throw new HttpError(
              409,
              "Your organization has no active primary ledger.",
            );
          return {
            record: await createAccountingAccount(client, context, {
              ledgerId,
              ...input,
            }),
          };
        }
        case "journal-create":
          return { record: await createJournalEntry(client, context, input) };
        case "journal-submit":
          return {
            record: await submitJournalEntry(client, context, idOf(input)),
          };
        case "journal-approve":
          return {
            record: await approveJournalEntry(
              client,
              context,
              idOf(input),
              str(input, "contentHash"),
            ),
          };
        case "journal-reject":
          return {
            record: await rejectJournalApproval(client, context, idOf(input)),
          };
        case "journal-post":
          return {
            record: await postJournalEntry(client, context, idOf(input)),
          };
        case "journal-reverse":
          return {
            record: await reverseJournalEntry(client, context, idOf(input), {
              reason: str(input, "reason"),
            }),
          };
        case "invoice-create":
          return {
            record: await createCustomerInvoice(client, context, input),
          };
        case "invoice-submit":
          return {
            record: await submitCustomerInvoice(client, context, idOf(input)),
          };
        case "invoice-approve":
          return {
            record: await approveCustomerInvoice(
              client,
              context,
              idOf(input),
              str(input, "contentHash"),
            ),
          };
        case "invoice-reject":
          return {
            record: await rejectCustomerInvoiceApproval(
              client,
              context,
              idOf(input),
            ),
          };
        case "invoice-post":
          return {
            record: await postCustomerInvoice(client, context, idOf(input)),
          };
        case "credit-note-apply":
          return {
            record: await applyCustomerCreditNote(
              client,
              context,
              idOf(input),
              input,
            ),
          };
        case "receipt-create":
          return {
            record: await createCustomerReceipt(client, context, input),
          };
        case "receipt-post":
          return {
            record: await postCustomerReceipt(client, context, idOf(input)),
          };
        case "receipt-allocate":
          return {
            record: await allocateCustomerReceipt(
              client,
              context,
              idOf(input),
              input,
            ),
          };
        case "bill-create":
          return { record: await createVendorBill(client, context, input) };
        case "bill-submit":
          return {
            record: await submitVendorBill(client, context, idOf(input)),
          };
        case "bill-approve":
          return {
            record: await approveVendorBill(
              client,
              context,
              idOf(input),
              str(input, "contentHash"),
            ),
          };
        case "bill-reject":
          return {
            record: await rejectVendorBillApproval(
              client,
              context,
              idOf(input),
            ),
          };
        case "bill-post":
          return { record: await postVendorBill(client, context, idOf(input)) };
        case "vendor-credit-apply":
          return {
            record: await applyVendorCreditNote(
              client,
              context,
              idOf(input),
              input,
            ),
          };
        case "payment-create":
          return { record: await createVendorPayment(client, context, input) };
        case "payment-submit":
          return {
            record: await submitVendorPayment(client, context, idOf(input)),
          };
        case "payment-approve":
          return {
            record: await approveVendorPayment(
              client,
              context,
              idOf(input),
              str(input, "contentHash"),
            ),
          };
        case "payment-reject":
          return {
            record: await rejectVendorPaymentApproval(
              client,
              context,
              idOf(input),
            ),
          };
        case "payment-post":
          return {
            record: await postVendorPayment(client, context, idOf(input)),
          };
        case "payment-allocate":
          return {
            record: await allocateVendorPayment(
              client,
              context,
              idOf(input),
              input,
            ),
          };
        case "bank-account-create":
          return { record: await createBankAccount(client, context, input) };
        case "statement-import":
          return { record: await importBankStatement(client, context, input) };
        case "reconciliation-start":
          return {
            record: await startBankReconciliation(client, context, input),
          };
        case "reconciliation-match":
          return {
            record: await matchBankStatementLine(
              client,
              context,
              str(input, "reconciliationId"),
              input,
            ),
          };
        case "reconciliation-complete":
          return {
            record: await completeBankReconciliation(
              client,
              context,
              idOf(input),
            ),
          };
        case "period-status":
          return {
            record: await updateFiscalPeriodStatus(
              client,
              context,
              idOf(input),
              input,
            ),
          };
        case "close-run-create":
          return { record: await createCloseRun(client, context, input) };
        case "close-task-update":
          return {
            record: await updateCloseTask(
              client,
              context,
              str(input, "runId"),
              str(input, "taskId"),
              input,
            ),
          };
        case "close-run-complete":
          return {
            record: await completeCloseRun(client, context, idOf(input), input),
          };
        default:
          throw new HttpError(404, "Unknown Accounting action.");
      }
    },
    200,
    "accounting.view",
  );
}
