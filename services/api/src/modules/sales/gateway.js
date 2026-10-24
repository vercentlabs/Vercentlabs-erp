// Pay online on the invoice link (Sales report Phase 3). A company connects its own Razorpay account (Sales settings › Online payments):
// the money goes to the company, not to Vercentlabs. On a shared invoice link the customer presses Pay now: the server creates a
// Razorpay order for the amount due, the browser opens Razorpay Checkout, and the payment is recorded as a receipt against that invoice
// when the checkout's signature checks out — or, if the window closed first, when Razorpay's webhook says it was captured. Each Razorpay
// payment is recorded once. Keys are kept encrypted; only the public key id reaches the browser.
import { createHmac, timingSafeEqual } from "node:crypto";
import { setTenantContext } from "@vercentlabs/database";

import { decryptSecret, encryptSecret } from "../../core/platform/secrets/index.js";
import { recordCustomerPayment } from "./payments/index.js";
import { resolveSharedDocument } from "./portal.js";
import { SalesError } from "./index.js";

const API = "https://api.razorpay.com/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const can = (context, permission) => Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission));
const invalid = (message, field) => new SalesError(400, message, "SALES_GATEWAY_INVALID", { field });
const same = (expected, actual) => {
  const a = Buffer.from(String(expected), "utf8");
  const b = Buffer.from(String(actual ?? ""), "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
};
// The account that records a payment made through the link: it may record payments and nothing else.
const gatewayContext = (organizationId) => ({ organizationId, userId: null, roleSlugs: [],
  permissions: ["sales.view", "sales.invoice.view", "sales.invoice.view_all", "sales.invoice.record_payment", "sales.customers.view", "sales.customers.view_all"] });

const view = (row, env = process.env) => row && ({
  provider: row.provider, keyId: row.key_id, mode: row.key_id?.startsWith("rzp_live_") ? "live" : "test", active: row.status === "active", bankAccountId: row.bank_account_id,
  webhookUrl: `${String(env.APP_URL || env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "")}/api/sales/public/payments/webhook/${row.organization_id}`, updatedAt: row.updated_at,
});

export async function getPaymentGateway(client, context, env = process.env) {
  if (!can(context, "sales.settings.manage")) throw new SalesError(403, "You do not have permission to set up online payments.", "PERMISSION_DENIED");
  return { gateway: view((await client.query("SELECT * FROM tenant.sales_payment_gateways WHERE organization_id = $1", [context.organizationId])).rows[0] ?? null, env) };
}

// input: { keyId, keySecret?, webhookSecret?, bankAccountId?, active? } — a secret left empty keeps the one saved.
export async function savePaymentGateway(client, context, input = {}, env = process.env) {
  if (!can(context, "sales.settings.manage")) throw new SalesError(403, "You do not have permission to set up online payments.", "PERMISSION_DENIED");
  const keyId = String(input.keyId ?? "").trim();
  if (!/^rzp_(test|live)_[A-Za-z0-9]{6,40}$/.test(keyId)) throw invalid("Enter the Razorpay key id (it starts with rzp_live_ or rzp_test_).", "keyId");
  const existing = (await client.query("SELECT * FROM tenant.sales_payment_gateways WHERE organization_id = $1", [context.organizationId])).rows[0];
  const saved = existing ? await decryptSecret(existing.encrypted_secrets, env) : {};
  const keySecret = String(input.keySecret ?? "").trim() || saved.keySecret;
  const webhookSecret = String(input.webhookSecret ?? "").trim() || saved.webhookSecret;
  if (!keySecret) throw invalid("Enter the Razorpay key secret.", "keySecret");
  if (!webhookSecret) throw invalid("Enter the webhook secret you set in Razorpay.", "webhookSecret");
  const bankAccountId = input.bankAccountId && UUID.test(String(input.bankAccountId)) ? input.bankAccountId : null;
  const sealed = await encryptSecret({ keySecret, webhookSecret }, env);
  const row = (await client.query(
    `INSERT INTO tenant.sales_payment_gateways (organization_id, provider, key_id, encrypted_secrets, bank_account_id, status, created_by, updated_by)
     VALUES ($1, 'razorpay', $2, $3::jsonb, $4, $5, $6, $6)
     ON CONFLICT (organization_id) DO UPDATE SET key_id = EXCLUDED.key_id, encrypted_secrets = EXCLUDED.encrypted_secrets, bank_account_id = EXCLUDED.bank_account_id,
       status = EXCLUDED.status, updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING *`,
    [context.organizationId, keyId, JSON.stringify(sealed), bankAccountId, input.active === false ? "inactive" : "active", context.userId ?? null])).rows[0];
  return { gateway: view(row, env) };
}

async function activeGateway(client, organizationId, env) {
  const row = (await client.query("SELECT * FROM tenant.sales_payment_gateways WHERE organization_id = $1 AND status = 'active'", [organizationId])).rows[0];
  if (!row) return null;
  return { row, ...(await decryptSecret(row.encrypted_secrets, env)) };
}

// Whether a shared invoice can be paid online (the link page shows Pay now).
export async function gatewayOn(client, organizationId) {
  return Boolean((await client.query("SELECT 1 FROM tenant.sales_payment_gateways WHERE organization_id = $1 AND status = 'active'", [organizationId])).rows[0]);
}

async function razorpay(gateway, method, path, body, fetchImpl = fetch) {
  const response = await fetchImpl(`${API}${path}`, {
    method, headers: { authorization: `Basic ${Buffer.from(`${gateway.row.key_id}:${gateway.keySecret}`).toString("base64")}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new SalesError(502, data?.error?.description ? `Razorpay: ${data.error.description}` : "Razorpay did not respond. Try again in a minute.", "SALES_GATEWAY_FAILED");
  return data;
}

// The customer pressed Pay now on the link: a Razorpay order for what is still due. Returns what Checkout needs, or null for a bad link.
export async function startLinkPayment(client, token, { env = process.env, fetchImpl } = {}) {
  const shared = await resolveSharedDocument(client, token);
  if (!shared || shared.kind !== "invoice") return null;
  const gateway = await activeGateway(client, shared.organizationId, env);
  if (!gateway) throw new SalesError(409, "Online payment is not available for this invoice. Pay by UPI or bank transfer.", "SALES_GATEWAY_OFF");
  const invoice = (await client.query(
    `SELECT id, invoice_number, party_id, outstanding_amount, currency_code, status FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND id = $2`,
    [shared.organizationId, shared.documentId])).rows[0];
  const due = Math.round(Number(invoice?.outstanding_amount ?? 0) * 100);
  if (!invoice || due <= 0 || ["cancelled", "reversed"].includes(invoice.status)) throw new SalesError(409, "This invoice has nothing left to pay.", "SALES_GATEWAY_NOTHING_DUE");
  const currency = String(invoice.currency_code).trim();
  if (currency !== "INR") throw new SalesError(409, "Online payment takes rupees only. Pay by bank transfer.", "SALES_GATEWAY_CURRENCY");
  const order = await razorpay(gateway, "POST", "/orders", { amount: due, currency, receipt: String(invoice.invoice_number).slice(0, 40),
    notes: { invoice: invoice.invoice_number, organization: shared.organizationId } }, fetchImpl);
  await client.query(
    `INSERT INTO tenant.sales_gateway_payments (organization_id, invoice_id, party_id, gateway_order_id, amount, currency_code) VALUES ($1, $2, $3, $4, $5, $6)`,
    [shared.organizationId, invoice.id, invoice.party_id, order.id, (due / 100).toFixed(2), currency]);
  const company = (await client.query("SELECT COALESCE(NULLIF(legal_name, ''), name) AS name FROM public.organizations WHERE id = $1", [shared.organizationId])).rows[0];
  return { keyId: gateway.row.key_id, orderId: order.id, amount: due, currency, name: company?.name ?? "", description: `Invoice ${invoice.invoice_number}` };
}

// Records a captured Razorpay payment once: a receipt against the invoice (what it still owes; the rest stays as an advance).
async function recordGatewayPayment(client, organizationId, gateway, { orderId, paymentId, method }) {
  const pending = (await client.query("SELECT * FROM tenant.sales_gateway_payments WHERE organization_id = $1 AND gateway_order_id = $2 FOR UPDATE", [organizationId, orderId])).rows[0];
  if (!pending) return null;
  if (pending.status === "recorded") return { receiptId: pending.receipt_id, replayed: true };
  const context = gatewayContext(organizationId);
  const owed = Number((await client.query("SELECT outstanding_amount FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND id = $2",
    [organizationId, pending.invoice_id])).rows[0]?.outstanding_amount ?? 0);
  const amount = Number(pending.amount);
  const applied = Math.min(owed, amount);
  const receipt = await recordCustomerPayment(client, context, {
    partyId: pending.party_id, amount, paymentMethod: method === "upi" ? "upi" : method === "card" ? "card" : "other", reference: paymentId,
    bankAccountId: gateway.row.bank_account_id ?? undefined, currencyCode: pending.currency_code, notes: `Paid online through Razorpay (${paymentId})`,
    allocations: applied > 0 ? [{ invoiceId: pending.invoice_id, amount: applied }] : [],
  });
  await client.query("UPDATE tenant.sales_gateway_payments SET status = 'recorded', gateway_payment_id = $3, receipt_id = $4, recorded_at = now() WHERE organization_id = $1 AND id = $2",
    [organizationId, pending.id, paymentId, receipt.receiptId]);
  return { receiptId: receipt.receiptId, replayed: false };
}

// The checkout's answer from the browser: { orderId, paymentId, signature }. The signature is checked with the company's key secret.
export async function confirmLinkPayment(client, token, input = {}, { env = process.env, fetchImpl } = {}) {
  const shared = await resolveSharedDocument(client, token);
  if (!shared || shared.kind !== "invoice") return null;
  const gateway = await activeGateway(client, shared.organizationId, env);
  if (!gateway) throw new SalesError(409, "Online payment is not available for this invoice.", "SALES_GATEWAY_OFF");
  const orderId = String(input.orderId ?? "");
  const paymentId = String(input.paymentId ?? "");
  const expected = createHmac("sha256", gateway.keySecret).update(`${orderId}|${paymentId}`).digest("hex");
  if (!orderId || !paymentId || !same(expected, input.signature))
    throw new SalesError(400, "The payment could not be confirmed here. If money left your account it will show on the invoice shortly.", "SALES_GATEWAY_SIGNATURE");
  const pending = (await client.query("SELECT invoice_id FROM tenant.sales_gateway_payments WHERE organization_id = $1 AND gateway_order_id = $2", [shared.organizationId, orderId])).rows[0];
  if (!pending || pending.invoice_id !== shared.documentId) throw new SalesError(400, "This payment is not for this invoice.", "SALES_GATEWAY_SIGNATURE");
  const payment = await razorpay(gateway, "GET", `/payments/${encodeURIComponent(paymentId)}`, null, fetchImpl).catch(() => ({}));
  return recordGatewayPayment(client, shared.organizationId, gateway, { orderId, paymentId, method: payment.method });
}

// Razorpay's webhook (payment.captured / order.paid), signed with the company's webhook secret over the exact body.
export async function receiveGatewayWebhook(client, organizationId, rawBody, signature, env = process.env) {
  if (!UUID.test(String(organizationId ?? ""))) return { ignored: true };
  await setTenantContext(client, organizationId);
  const gateway = await activeGateway(client, organizationId, env);
  if (!gateway) return { ignored: true };
  const expected = createHmac("sha256", gateway.webhookSecret).update(rawBody).digest("hex");
  if (!same(expected, signature)) throw new SalesError(401, "The webhook signature is not valid.", "SALES_GATEWAY_SIGNATURE");
  const event = JSON.parse(rawBody);
  const payment = event?.payload?.payment?.entity;
  if (!["payment.captured", "order.paid"].includes(event?.event) || !payment?.order_id || payment.status !== "captured") return { ignored: true };
  return (await recordGatewayPayment(client, organizationId, gateway, { orderId: payment.order_id, paymentId: payment.id, method: payment.method })) ?? { ignored: true };
}
