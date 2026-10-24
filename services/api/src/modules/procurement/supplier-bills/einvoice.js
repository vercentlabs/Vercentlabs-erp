// The supplier's e-invoice QR (Procurement report Phase 2). A GST e-invoice carries a QR signed by the Invoice Registration Portal: a JWT
// whose payload holds the seller's and buyer's GSTINs, the invoice number, type and date, the invoice value, the item count, the main HSN
// code, the IRN and its date. Scanned on the bill form, it fills the bill's header and is checked against the supplier and our GSTINs;
// the bill keeps the IRN. The signature is verified when the portal's public key is configured (EINVOICE_QR_PUBLIC_KEY, PEM).
import { createPublicKey, verify } from "node:crypto";

import { SupplierBillError, fail, text } from "./constants.js";

const IRN = /^[0-9a-f]{64}$/i;
const fromBase64Url = (value) => Buffer.from(String(value).replace(/-/g, "+").replace(/_/g, "/"), "base64");
// "24/10/2026" or "2026-10-24" as YYYY-MM-DD.
const isoDay = (value) => {
  const raw = String(value ?? "").trim();
  const indian = /^(\d{2})[/-](\d{2})[/-](\d{4})/.exec(raw);
  if (indian) return `${indian[3]}-${indian[2]}-${indian[1]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
};

function verified(token, env) {
  const pem = env.EINVOICE_QR_PUBLIC_KEY;
  if (!pem) return null;
  try {
    const [head, body, signature] = token.split(".");
    return verify("RSA-SHA256", Buffer.from(`${head}.${body}`), createPublicKey(pem.replace(/\\n/g, "\n")), fromBase64Url(signature));
  } catch {
    return false;
  }
}

// What the QR says. Throws when it is not an e-invoice QR.
export function readEInvoiceQr(raw, env = process.env) {
  const token = String(raw ?? "").trim();
  const parts = token.split(".");
  if (parts.length !== 3) fail("This is not a GST e-invoice QR code.", "qr", "EINVOICE_QR_INVALID");
  let data;
  try {
    const payload = JSON.parse(fromBase64Url(parts[1]).toString("utf8"));
    data = typeof payload.data === "string" ? JSON.parse(payload.data) : payload.data ?? payload;
  } catch {
    fail("The QR code could not be read as a GST e-invoice.", "qr", "EINVOICE_QR_INVALID");
  }
  const irn = text(data.Irn, 64);
  if (!irn || !IRN.test(irn)) fail("The QR code has no valid IRN: it is not a registered e-invoice.", "qr", "EINVOICE_QR_INVALID");
  return {
    supplierGstin: text(data.SellerGstin, 15)?.toUpperCase() ?? null, buyerGstin: text(data.BuyerGstin, 15)?.toUpperCase() ?? null,
    invoiceNumber: text(data.DocNo, 50), documentType: text(data.DocTyp, 10), invoiceDate: isoDay(data.DocDt), total: data.TotInvVal === undefined ? null : String(data.TotInvVal),
    itemCount: data.ItemCnt === undefined ? null : Number(data.ItemCnt), mainHsnCode: text(data.MainHsnCode, 10), irn: irn.toLowerCase(), irnDate: isoDay(data.IrnDt),
    signatureVerified: verified(token, env),
  };
}

// checkEInvoiceQr: the QR read and matched — the supplier with that GSTIN, whether the buyer GSTIN is one of ours, and whether a bill
// already carries the IRN. Returns { qr, supplier: { id, name } | null, problems: [...] }.
export async function checkEInvoiceQr(client, context, { qr }) {
  const read = readEInvoiceQr(qr);
  const problems = [];
  const supplier = read.supplierGstin ? (await client.query(
    `SELECT supplier.id, party.display_name AS name, supplier.status FROM tenant.procurement_suppliers supplier
       JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
      WHERE supplier.organization_id = $1 AND (upper(party.gstin) = $2 OR EXISTS (SELECT 1 FROM tenant.procurement_supplier_tax_registrations registration
              WHERE registration.organization_id = supplier.organization_id AND registration.supplier_id = supplier.id AND upper(registration.gstin) = $2))
      ORDER BY (supplier.status = 'active') DESC LIMIT 1`, [context.organizationId, read.supplierGstin])).rows[0] ?? null : null;
  if (!supplier) problems.push(`No supplier has the GSTIN ${read.supplierGstin ?? "on the QR"}: add it to the supplier first.`);
  const ours = read.buyerGstin ? (await client.query(`SELECT 1 FROM tenant.tax_registrations WHERE organization_id = $1 AND upper(registration_number) = $2`,
    [context.organizationId, read.buyerGstin])).rowCount > 0 : false;
  if (!ours) problems.push(`The invoice is made out to ${read.buyerGstin ?? "another buyer"}, which is not one of our GSTINs.`);
  const existing = (await client.query(`SELECT bill_number FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND lower(irn) = $2 AND status NOT IN ('cancelled', 'reversed') LIMIT 1`,
    [context.organizationId, read.irn])).rows[0];
  if (existing) problems.push(`This e-invoice is already recorded as bill ${existing.bill_number}.`);
  if (read.signatureVerified === false) problems.push("The QR's signature does not match the GST portal's: the invoice may have been changed.");
  if (!["INV", "DBN", "CRN"].includes(read.documentType ?? "INV")) problems.push(`The QR is for a ${read.documentType} document.`);
  return { qr: read, supplier: supplier && { id: supplier.id, name: supplier.name, status: supplier.status }, problems };
}

// A bill's IRN as entered or scanned: 64 hexadecimal characters, or none. Throws for anything else.
export function readIrn(value) {
  const raw = text(value, 64);
  if (!raw) return null;
  if (!IRN.test(raw)) throw new SupplierBillError(400, "An IRN is 64 letters and digits (0–9, a–f).", "SUPPLIER_BILL_IRN_INVALID", { issues: [{ field: "irn", message: "Enter the 64-character IRN." }] });
  return raw.toLowerCase();
}
