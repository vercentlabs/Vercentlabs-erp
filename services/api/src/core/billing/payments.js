// Local ledger of provider payments and provider invoices/receipts. Only the
// fields billing needs are kept: never card numbers, CVV, bank credentials,
// UPI handles, customer contact details or raw instrument data.
import { epoch } from "./shared.js";

const text = (value, max = 64) => (value === undefined || value === null ? null : String(value).slice(0, max));
const paise = (value) => {
  const numeric = Number(value ?? 0);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0;
};

// Payment method CATEGORY only (card/upi/netbanking/...), never the instrument.
const METHOD_CATEGORIES = new Set(["card", "upi", "netbanking", "wallet", "emandate", "nach", "bank_transfer", "paylater", "cardless_emi", "emi"]);

export function minimalPaymentSnapshot(payment) {
  return {
    id: text(payment.id),
    status: text(payment.status, 32),
    invoice_id: text(payment.invoice_id),
    order_id: text(payment.order_id),
    method: METHOD_CATEGORIES.has(payment.method) ? payment.method : null,
    captured: Boolean(payment.captured),
    refund_status: text(payment.refund_status, 32),
    error_code: text(payment.error_code, 64),
    created_at: Number.isSafeInteger(payment.created_at) ? payment.created_at : null,
  };
}

export function minimalInvoiceSnapshot(invoice) {
  return {
    id: text(invoice.id),
    status: text(invoice.status, 32),
    subscription_id: text(invoice.subscription_id),
    payment_id: text(invoice.payment_id),
    billing_start: Number.isSafeInteger(invoice.billing_start) ? invoice.billing_start : null,
    billing_end: Number.isSafeInteger(invoice.billing_end) ? invoice.billing_end : null,
  };
}

export async function upsertPaymentInTx(client, { organizationId, subscriptionId, payment }) {
  if (!payment?.id) return;
  const snapshot = minimalPaymentSnapshot(payment);
  await client.query(
    `INSERT INTO billing_payments (organization_id, subscription_id, provider_payment_id, provider_invoice_id, amount_paise, fee_paise, tax_paise, currency,
                                   status, method, captured_at, amount_refunded_paise, refund_status, provider_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
     ON CONFLICT (provider, provider_payment_id) DO UPDATE SET status=EXCLUDED.status, amount_paise=EXCLUDED.amount_paise,
       fee_paise=EXCLUDED.fee_paise, tax_paise=EXCLUDED.tax_paise, method=COALESCE(EXCLUDED.method, billing_payments.method),
       captured_at=COALESCE(EXCLUDED.captured_at, billing_payments.captured_at),
       amount_refunded_paise=GREATEST(EXCLUDED.amount_refunded_paise, billing_payments.amount_refunded_paise),
       refund_status=COALESCE(EXCLUDED.refund_status, billing_payments.refund_status),
       provider_invoice_id=COALESCE(EXCLUDED.provider_invoice_id, billing_payments.provider_invoice_id), provider_snapshot=EXCLUDED.provider_snapshot
     WHERE billing_payments.organization_id = EXCLUDED.organization_id`,
    [
      organizationId, subscriptionId, snapshot.id, snapshot.invoice_id, paise(payment.amount), paise(payment.fee), paise(payment.tax),
      String(payment.currency || "INR").slice(0, 3), snapshot.status || "created", snapshot.method,
      payment.status === "captured" || payment.captured ? epoch(payment.created_at) : null, paise(payment.amount_refunded), snapshot.refund_status,
      JSON.stringify(snapshot),
    ],
  );
}

export async function upsertInvoiceInTx(client, { organizationId, subscriptionId, invoice }) {
  if (!invoice?.id) return;
  const url = typeof invoice.short_url === "string" && /^https:\/\/[^\s"<>]+$/.test(invoice.short_url) ? invoice.short_url.slice(0, 500) : null;
  await client.query(
    `INSERT INTO billing_invoices (organization_id, subscription_id, provider_invoice_id, amount_paise, amount_due_paise, amount_paid_paise, tax_paise, currency,
                                   status, invoice_url, issued_at, paid_at, provider_snapshot, document_kind)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,'provider_invoice')
     ON CONFLICT (provider, provider_invoice_id) DO UPDATE SET status=EXCLUDED.status, amount_paid_paise=EXCLUDED.amount_paid_paise,
       amount_due_paise=EXCLUDED.amount_due_paise, paid_at=COALESCE(EXCLUDED.paid_at, billing_invoices.paid_at),
       invoice_url=COALESCE(EXCLUDED.invoice_url, billing_invoices.invoice_url), provider_snapshot=EXCLUDED.provider_snapshot
     WHERE billing_invoices.organization_id = EXCLUDED.organization_id`,
    [
      organizationId, subscriptionId, text(invoice.id), paise(invoice.amount), paise(invoice.amount_due), paise(invoice.amount_paid), paise(invoice.tax_amount),
      String(invoice.currency || "INR").slice(0, 3), text(invoice.status, 32) || "issued", url, epoch(invoice.issued_at || invoice.created_at), epoch(invoice.paid_at),
      JSON.stringify(minimalInvoiceSnapshot(invoice)),
    ],
  );
}

// A refund reported by the provider: the ledger must not keep showing the
// payment as fully successful. Vercentlabs never issues refunds from here.
export async function recordRefundInTx(client, { organizationId, refund }) {
  if (!refund?.payment_id) return false;
  const updated = await client.query(
    `UPDATE billing_payments SET amount_refunded_paise = GREATEST(amount_refunded_paise, amount_refunded_paise + $3),
            refund_status = CASE WHEN amount_refunded_paise + $3 >= amount_paise THEN 'full' ELSE 'partial' END
      WHERE organization_id = $1 AND provider_payment_id = $2 AND $4::boolean
      RETURNING id`,
    [organizationId, String(refund.payment_id), paise(refund.amount), ["processed"].includes(String(refund.status))],
  );
  return Boolean(updated.rows[0]);
}
