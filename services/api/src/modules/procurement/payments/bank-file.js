// The bank payment file (Procurement report Phase 2): after "Pay selected", one file with a line per supplier payment to upload to the
// bank's bulk payments, so nobody types account numbers. Each line pays the supplier's primary bank account in the payment's currency;
// NEFT below ₹2 lakh, RTGS from ₹2 lakh. The layout is set in Procurement Setup: CSV with a header line, or the same without it; the
// debit account (our account the bank pays from) is set there too. A payment without the supplier's bank account is left out and named.
import { formatDecimal, roundMoney, decimal } from "../../../core/decimal.js";
import { poCan } from "../purchase-orders/access.js";
import { BILL_PERMISSIONS, SupplierBillError, requireUuid } from "../supplier-bills/constants.js";

const RTGS_FROM = decimal("200000");
const BANK_FILE_LAYOUTS = Object.freeze([{ code: "csv_header", label: "CSV with a header line" }, { code: "csv_plain", label: "CSV without a header line" }]);
export { BANK_FILE_LAYOUTS };

const quote = (value) => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const day = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  const pad = (number) => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
};

// bankFileFor: paymentIds → { fileName, content, included, problems }. Marks the included payments as sent to the bank.
export async function bankFileFor(client, context, { paymentIds = [] } = {}) {
  if (!poCan(context, BILL_PERMISSIONS.payments))
    throw new SupplierBillError(403, "You do not have permission to make bank payment files.", "PERMISSION_DENIED");
  const ids = [...new Set((Array.isArray(paymentIds) ? paymentIds : []).map((id) => requireUuid(id, "Payment")))];
  if (!ids.length) throw new SupplierBillError(400, "Choose the payments for the bank file.", "BANK_FILE_EMPTY");
  const settings = (await client.query(`SELECT bank_file_layout, bank_file_debit_account FROM tenant.procurement_settings WHERE organization_id = $1`, [context.organizationId])).rows[0] ?? {};
  const payments = (await client.query(
    `SELECT payment.id, payment.payment_number, payment.payment_date, payment.amount, payment.withholding_amount, btrim(payment.currency_code) AS currency_code, payment.status,
            payment.payment_method, payment.external_reference, party.display_name AS supplier_name, COALESCE(supplier.primary_email, party.email) AS supplier_email,
            account.account_holder, account.account_number, account.ifsc_code, account.bank_name
       FROM tenant.accounting_vendor_payments payment
       JOIN tenant.business_parties party ON party.organization_id = payment.organization_id AND party.id = payment.party_id
       LEFT JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = party.organization_id AND supplier.party_id = party.id
       LEFT JOIN LATERAL (SELECT * FROM tenant.accounting_supplier_bank_accounts bank WHERE bank.organization_id = payment.organization_id AND bank.supplier_id = supplier.id
                            AND bank.status = 'active' AND (bank.currency_code IS NULL OR btrim(bank.currency_code) = btrim(payment.currency_code))
                          ORDER BY bank.is_primary DESC, bank.created_at LIMIT 1) account ON true
      WHERE payment.organization_id = $1 AND payment.id = ANY($2::uuid[]) ORDER BY payment.payment_number`, [context.organizationId, ids])).rows;
  const problems = [];
  const included = [];
  const lines = [];
  for (const payment of payments) {
    if (["cancelled", "reversed", "rejected"].includes(payment.status)) { problems.push(`${payment.payment_number} is ${payment.status}.`); continue; }
    if (payment.payment_method !== "bank_transfer") { problems.push(`${payment.payment_number} is not a bank transfer.`); continue; }
    if (!payment.account_number || !payment.ifsc_code) { problems.push(`${payment.supplier_name} has no bank account with an IFSC for ${payment.currency_code}: ${payment.payment_number} is left out.`); continue; }
    // What the bank pays: the payment less any TDS deducted on it.
    const paid = roundMoney(decimal(payment.amount) - decimal(payment.withholding_amount ?? 0), 2);
    lines.push([paid >= RTGS_FROM ? "RTGS" : "NEFT", settings.bank_file_debit_account ?? "", payment.account_holder || payment.supplier_name, payment.account_number, payment.ifsc_code,
      formatDecimal(paid, 2), day(payment.payment_date), payment.payment_number, (payment.external_reference ?? "").slice(0, 30), payment.supplier_email ?? ""].map(quote).join(","));
    included.push(payment.id);
  }
  if (!settings.bank_file_debit_account) problems.push("Set the account the bank pays from in Procurement Setup › Billing Rules; the file leaves it empty.");
  const header = ["Payment type", "Debit account", "Beneficiary name", "Beneficiary account", "IFSC", "Amount", "Value date", "Reference", "Remarks", "Beneficiary email"].join(",");
  const content = [...(settings.bank_file_layout === "csv_plain" ? [] : [header]), ...lines].join("\r\n");
  if (included.length)
    await client.query(`UPDATE tenant.accounting_vendor_payments SET bank_file_exported_at = now() WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [context.organizationId, included]);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return { fileName: `supplier-payments-${stamp}.csv`, content, included: included.length, problems };
}
