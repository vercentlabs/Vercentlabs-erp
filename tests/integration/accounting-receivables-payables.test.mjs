// Real PostgreSQL integration test -- the receivables and payables subledgers: customer invoice ->
// submit/approve -> post -> receipt -> allocation -> credit note (F463-470), and the symmetric vendor
// side, bill -> submit/approve -> post -> payment -> allocation -> credit note (F471-475). Both
// subledgers reuse the same generic maker-checker engine (subledger-approvals.js) this session found
// already proven; these tests exercise its two real default postures -- customer_invoice defaults to
// NOT requiring approval (required=false, threshold=0), vendor_bill/vendor_payment default to ALWAYS
// requiring it (required=true) -- against the concrete document lifecycle.
import assert from "node:assert/strict";
import test from "node:test";

import { ALL_ACCOUNTING, buildAccountingWorld, connectAdmin } from "./accounting-test-kit.mjs";

const ROLES = {
  acctA: ALL_ACCOUNTING,
  acctB: ALL_ACCOUNTING,
  viewer: ["accounting.view", "accounting.reports.view"],
};

test("Accounting receivables and payables subledgers against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildAccountingWorld(admin, ROLES, "arap");
  const { api, run, denied, sql, companyId, customerId, supplierId } = w;
  const ids = {};

  try {
    await t.test("F463-465: a customer invoice defaults to auto-approve on submit (required=false, threshold=0), then posts a balanced receivable/revenue journal", async () => {
      await denied("viewer", (c, x) => api.createCustomerInvoice(c, x, { companyId, partyId: customerId, lines: [{ description: "Consulting", unitPrice: 1000 }] }), 403);
      const { invoice } = await run("acctA", (c, x) => api.createCustomerInvoice(c, x, { companyId, partyId: customerId, lines: [{ description: "Consulting", quantity: 2, unitPrice: 500 }] }));
      assert.equal(invoice.status, "draft");
      assert.equal(Number(invoice.grand_total), 1000);
      ids.invoice1 = invoice.id;
      const submitted = await run("acctA", (c, x) => api.submitCustomerInvoice(c, x, invoice.id));
      assert.equal(submitted.status, "approved", "customer invoices default to not requiring a second approver");
      const { invoice: posted } = await run("acctA", (c, x) => api.postCustomerInvoice(c, x, invoice.id));
      assert.equal(posted.status, "posted");
      assert.equal(Number(posted.outstanding_amount), 1000);
      const [balance] = await sql(`SELECT sum(base_debit_amount) AS d, sum(base_credit_amount) AS cr FROM tenant.accounting_journal_lines WHERE organization_id=$1 AND journal_entry_id=$2`, [w.orgId, posted.journal_entry_id]);
      assert.equal(Number(balance.d), Number(balance.cr));
      assert.equal(Number(balance.d), 1000);
    });

    await t.test("F466-467: a customer receipt posts directly from draft (no maker-checker) and allocates against the open invoice", async () => {
      const receipt = await run("acctA", (c, x) => api.createCustomerReceipt(c, x, { companyId, partyId: customerId, amount: 1000, paymentMethod: "bank_transfer" }));
      assert.equal(receipt.status, "draft");
      const posted = await run("acctA", (c, x) => api.postCustomerReceipt(c, x, receipt.id));
      assert.equal(posted.status, "posted");
      assert.equal(Number(posted.unapplied_amount), 1000);
      const allocated = await run("acctA", (c, x) => api.allocateCustomerReceipt(c, x, receipt.id, { allocations: [{ invoiceId: ids.invoice1, amount: 1000 }] }));
      assert.equal(allocated.status, "applied");
      assert.equal(Number(allocated.unapplied_amount), 0);
      const [invoice] = await sql(`SELECT status, outstanding_amount FROM tenant.accounting_customer_invoices WHERE organization_id=$1 AND id=$2`, [w.orgId, ids.invoice1]);
      assert.equal(invoice.status, "paid");
      assert.equal(Number(invoice.outstanding_amount), 0);
    });

    await t.test("F468-469: a duplicate allocation and an over-allocation are both refused", async () => {
      const { invoice } = await run("acctA", (c, x) => api.createCustomerInvoice(c, x, { companyId, partyId: customerId, lines: [{ description: "Support retainer", unitPrice: 400 }] }));
      const submitted = await run("acctA", (c, x) => api.submitCustomerInvoice(c, x, invoice.id));
      assert.equal(submitted.status, "approved");
      await run("acctA", (c, x) => api.postCustomerInvoice(c, x, invoice.id));
      const receipt = await run("acctA", (c, x) => api.createCustomerReceipt(c, x, { companyId, partyId: customerId, amount: 400, paymentMethod: "cash" }));
      await run("acctA", (c, x) => api.postCustomerReceipt(c, x, receipt.id));
      const overAllocated = await run("acctA", (c, x) => api.allocateCustomerReceipt(c, x, receipt.id, { allocations: [{ invoiceId: invoice.id, amount: 5000 }] })).catch((e) => e);
      assert.equal(overAllocated.status, 409, "an allocation exceeding the invoice outstanding amount is refused");
      const allocated = await run("acctA", (c, x) => api.allocateCustomerReceipt(c, x, receipt.id, { allocations: [{ invoiceId: invoice.id, amount: 400 }] }));
      assert.equal(allocated.status, "applied");
      ids.receipt2 = receipt.id;
      ids.invoice2 = invoice.id;
      const duplicate = await run("acctA", (c, x) => api.allocateCustomerReceipt(c, x, receipt.id, { allocations: [{ invoiceId: invoice.id, amount: 1 }] })).catch((e) => e);
      assert.equal(duplicate.status, 409, "the same receipt cannot be allocated to the same invoice twice");
    });

    await t.test("F470: a customer credit note applies against the original invoice, reducing what is owed", async () => {
      const { invoice } = await run("acctA", (c, x) => api.createCustomerInvoice(c, x, { companyId, partyId: customerId, lines: [{ description: "Widgets", quantity: 10, unitPrice: 100 }] }));
      await run("acctA", (c, x) => api.submitCustomerInvoice(c, x, invoice.id));
      await run("acctA", (c, x) => api.postCustomerInvoice(c, x, invoice.id));
      const { invoice: creditNote } = await run("acctA", (c, x) => api.createCustomerInvoice(c, x, { companyId, partyId: customerId, invoiceType: "credit_note", sourceInvoiceId: invoice.id, lines: [{ description: "Return of 2 widgets", quantity: 2, unitPrice: 100 }] }));
      assert.equal(creditNote.invoice_type, "credit_note");
      await run("acctA", (c, x) => api.submitCustomerInvoice(c, x, creditNote.id));
      const { invoice: postedCredit } = await run("acctA", (c, x) => api.postCustomerInvoice(c, x, creditNote.id));
      assert.equal(postedCredit.status, "posted");
      const applied = await run("acctA", (c, x) => api.applyCustomerCreditNote(c, x, creditNote.id, { allocations: [{ invoiceId: invoice.id, amount: 200 }] }));
      assert.ok(applied);
      const [after] = await sql(`SELECT outstanding_amount FROM tenant.accounting_customer_invoices WHERE organization_id=$1 AND id=$2`, [w.orgId, invoice.id]);
      assert.equal(Number(after.outstanding_amount), 800, "the original invoice's outstanding balance drops by the credit note amount");
    });

    await t.test("F471-472: a vendor bill defaults to REQUIRING approval (required=true); the submitter cannot self-approve, and posting is blocked until approved", async () => {
      const { bill } = await run("acctA", (c, x) => api.createVendorBill(c, x, { companyId, partyId: supplierId, lines: [{ description: "Office rent", unitPrice: 2000 }] }));
      assert.equal(bill.status, "draft");
      ids.bill1 = bill.id;
      const blockedPost = await run("acctA", (c, x) => api.postVendorBill(c, x, bill.id)).catch((e) => e);
      assert.equal(blockedPost.status, 409, "a draft bill cannot be posted");
      const submitted = await run("acctA", (c, x) => api.submitVendorBill(c, x, bill.id));
      assert.equal(submitted.status, "pending_approval", "vendor bills default to requiring a second approver");
      const selfApprove = await run("acctA", (c, x) => api.approveVendorBill(c, x, bill.id, submitted.contentHash)).catch((e) => e);
      assert.equal(selfApprove.status, 409, "the submitter cannot approve their own bill");
      const approved = await run("acctB", (c, x) => api.approveVendorBill(c, x, bill.id, submitted.contentHash));
      assert.equal(approved.status, "approved");
      const { bill: posted } = await run("acctA", (c, x) => api.postVendorBill(c, x, bill.id));
      assert.equal(posted.status, "posted");
      const [balance] = await sql(`SELECT sum(base_debit_amount) AS d, sum(base_credit_amount) AS cr FROM tenant.accounting_journal_lines WHERE organization_id=$1 AND journal_entry_id=$2`, [w.orgId, posted.journal_entry_id]);
      assert.equal(Number(balance.d), Number(balance.cr));
    });

    await t.test("F473-474: a vendor payment (also requiring approval by default) posts and allocates against the open bill", async () => {
      const payment = await run("acctA", (c, x) => api.createVendorPayment(c, x, { companyId, partyId: supplierId, amount: 2000, paymentMethod: "bank_transfer" }));
      assert.equal(payment.status, "draft");
      const submitted = await run("acctA", (c, x) => api.submitVendorPayment(c, x, payment.id));
      assert.equal(submitted.status, "pending_approval");
      const approved = await run("acctB", (c, x) => api.approveVendorPayment(c, x, payment.id, submitted.contentHash));
      assert.equal(approved.status, "approved");
      const posted = await run("acctA", (c, x) => api.postVendorPayment(c, x, payment.id));
      assert.equal(posted.status, "posted");
      const allocated = await run("acctA", (c, x) => api.allocateVendorPayment(c, x, payment.id, { allocations: [{ billId: ids.bill1, amount: 2000 }] }));
      assert.equal(allocated.status, "applied");
      const [bill] = await sql(`SELECT status, outstanding_amount FROM tenant.accounting_vendor_bills WHERE organization_id=$1 AND id=$2`, [w.orgId, ids.bill1]);
      assert.equal(bill.status, "paid");
      assert.equal(Number(bill.outstanding_amount), 0);
    });

    await t.test("F475: a vendor bill with a matching exception is refused posting even once approved", async () => {
      const { bill } = await run("acctA", (c, x) => api.createVendorBill(c, x, { companyId, partyId: supplierId, matchingStatus: "exception", lines: [{ description: "Disputed goods", unitPrice: 300 }] }));
      assert.equal(bill.matching_status, "exception");
      const submitted = await run("acctA", (c, x) => api.submitVendorBill(c, x, bill.id));
      await run("acctB", (c, x) => api.approveVendorBill(c, x, bill.id, submitted.contentHash));
      const blocked = await run("acctA", (c, x) => api.postVendorBill(c, x, bill.id)).catch((e) => e);
      assert.equal(blocked.status, 409, "a bill with an unresolved matching exception cannot post");
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
