// e-invoice (IRN) and e-way bills through the company's GST Suvidha Provider (Shared Platform plan 7).
//
// The platform builds the government's JSON (e-invoice schema INV-01 v1.1; e-way bill schema) from the posted document's own snapshots,
// sends it to the GSP and keeps what comes back. The GSP holds the IRP / NIC credentials and does their encryption; the platform talks
// to it over one small JSON contract (EINVOICE_GSP_URL + EINVOICE_GSP_TOKEN, sent as a Bearer token with the GSTIN as x-gstin):
//   POST {url}/einvoice/generate        { gstin, invoice }                      -> { irn, ackNo, ackDate, signedQrCode, signedInvoice }
//   POST {url}/einvoice/cancel          { gstin, irn, reason, remarks }         -> { irn, cancelDate }
//   POST {url}/ewaybill/generate        { gstin, ewaybill }                     -> { ewbNo, ewbDate, validUpto }
//   POST {url}/ewaybill/update-part-b   { gstin, ewbNo, vehicleNo, ... }        -> { validUpto }
//   POST {url}/ewaybill/cancel          { gstin, ewbNo, reason, remarks }       -> { ewbNo, cancelDate }
// An error answer is { error: "message" } with a 4xx/5xx status. EINVOICE_GSP_URL=standin (never in production) answers locally, for
// tests and demos. Nothing is sent without a configured GSP.
import { createHash, randomInt } from "node:crypto";

import { isProductionRuntime } from "@vercentlabs/config";
import { hasSessionPermission } from "../../core/access/index.js";
import { unitUqcMap } from "../../core/tax/uqc.js";
import { getSalesInvoice } from "../../modules/sales/invoices/records.js";

export class ComplianceError extends Error {
  constructor(status, message, code = "GST_COMPLIANCE_ERROR", details) {
    super(message);
    this.name = "ComplianceError";
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const EWAY_BILL_THRESHOLD = 50000;
const round = (value) => Math.round(Number(value ?? 0) * 100) / 100;
const indianDate = (value) => {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").slice(0, 10);
  return text ? `${text.slice(8, 10)}/${text.slice(5, 7)}/${text.slice(0, 4)}` : null;
};
const pin = (value) => Number(String(value ?? "").replace(/\D/g, "").slice(0, 6)) || null;
const need = (session, permission, message) => {
  if (!hasSessionPermission(session, permission)) throw new ComplianceError(403, message, "PERMISSION_DENIED");
};

export function gspConfigured(env = process.env) {
  const url = String(env.EINVOICE_GSP_URL ?? "").trim();
  if (url === "standin") return !isProductionRuntime(env);
  return Boolean(url && String(env.EINVOICE_GSP_TOKEN ?? "").trim());
}

// The stand-in answers like a GSP would (IRN = SHA-256 of GSTIN, financial year, type and number, as the IRP computes it).
function standin(path, body) {
  const now = new Date().toISOString();
  if (path === "einvoice/generate") {
    const doc = body.invoice.DocDtls;
    const [, month, year] = doc.Dt.split("/").map(Number);
    const fy = month >= 4 ? `${year}-${String(year + 1).slice(2)}` : `${year - 1}-${String(year).slice(2)}`;
    const irn = createHash("sha256").update(`${body.gstin}${fy}${doc.Typ}${doc.No}`).digest("hex");
    return { irn, ackNo: String(randomInt(100000000, 999999999)) + String(randomInt(100000, 999999)), ackDate: now,
      signedQrCode: Buffer.from(JSON.stringify({ SellerGstin: body.gstin, BuyerGstin: body.invoice.BuyerDtls.Gstin, DocNo: doc.No, DocDt: doc.Dt, TotInvVal: body.invoice.ValDtls.TotInvVal, Irn: irn })).toString("base64url"),
      signedInvoice: "standin" };
  }
  if (path === "einvoice/cancel") return { irn: body.irn, cancelDate: now };
  if (path === "ewaybill/generate") return { ewbNo: String(randomInt(100000, 999999)) + String(randomInt(100000, 999999)), ewbDate: now,
    validUpto: new Date(Date.now() + Math.max(1, Math.ceil(Number(body.ewaybill.transDistance || 1) / 200)) * 864e5).toISOString() };
  if (path === "ewaybill/update-part-b") return { validUpto: new Date(Date.now() + 864e5).toISOString() };
  if (path === "ewaybill/cancel") return { ewbNo: body.ewbNo, cancelDate: now };
  throw new ComplianceError(500, "Unknown GSP call.");
}

async function gsp(path, body, { env = process.env, fetchImpl = fetch } = {}) {
  if (!gspConfigured(env)) throw new ComplianceError(503, "No GST Suvidha Provider (GSP) is configured. Set EINVOICE_GSP_URL and EINVOICE_GSP_TOKEN.", "GSP_NOT_CONFIGURED");
  const url = String(env.EINVOICE_GSP_URL).trim();
  if (url === "standin") return standin(path, body);
  let response;
  try {
    response = await fetchImpl(`${url.replace(/\/+$/, "")}/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${env.EINVOICE_GSP_TOKEN}`, "x-gstin": body.gstin },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20_000), redirect: "error",
    });
  } catch {
    throw new ComplianceError(502, "The GSP could not be reached. Try again.", "GSP_UNREACHABLE");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ComplianceError(response.status >= 500 ? 502 : 422, `The GSP refused it: ${String(payload?.error ?? payload?.message ?? response.status).slice(0, 400)}`, "GSP_REFUSED");
  return payload;
}

// ------------------------------------------------------------------ e-invoice
async function sellerRegistration(client, organizationId, registrationId) {
  return (await client.query(
    `SELECT * FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active' AND ($2::uuid IS NULL OR id = $2) ORDER BY is_default DESC LIMIT 1`,
    [organizationId, registrationId ?? null])).rows[0] ?? null;
}

// The INV-01 JSON for a posted sales invoice (from its snapshots).
export async function buildEInvoicePayload(client, session, invoiceId) {
  const detail = await getSalesInvoice(client, session, invoiceId);
  const { invoice, lines } = detail;
  const seller = await sellerRegistration(client, session.organizationId, invoice.seller_registration_id);
  if (!seller?.registration_number) throw new ComplianceError(409, "The invoice has no seller GSTIN.", "EINVOICE_NOT_APPLICABLE");
  const customer = invoice.sales_customer_snapshot || invoice.customer_snapshot || {};
  const billing = invoice.billing_address_snapshot || {};
  const uqcOf = await unitUqcMap(client, session.organizationId);
  const exportSupply = ["export", "sez"].includes(invoice.supply_type ?? invoice.supply_nature);
  const items = lines.map((line, index) => {
    const tax = (type) => round((line.taxes ?? []).filter((entry) => entry.tax_type === type).reduce((total, entry) => total + Number(entry.tax_amount ?? 0), 0));
    const rate = (line.taxes ?? []).filter((entry) => ["cgst", "sgst", "utgst", "igst"].includes(entry.tax_type)).reduce((total, entry) => total + Number(entry.rate ?? 0), 0);
    const gross = round(line.gross_amount ?? Number(line.quantity) * Number(line.unit_price));
    return {
      SlNo: String(index + 1), PrdDesc: String(line.item_name_snapshot ?? "Item").slice(0, 300), IsServc: line.hsn_sac_kind === "sac" ? "Y" : "N", HsnCd: String(line.hsn_sac_code ?? "").slice(0, 8),
      Qty: Number(line.quantity), Unit: uqcOf.get(String(line.uom_snapshot ?? "").toUpperCase()) ?? "OTH", UnitPrice: round(line.unit_price), TotAmt: gross,
      Discount: round(Number(line.discount_amount ?? 0)), AssAmt: round(line.net_amount), GstRt: rate,
      IgstAmt: tax("igst"), CgstAmt: tax("cgst"), SgstAmt: round(tax("sgst") + tax("utgst")), CesRt: 0, CesAmt: tax("cess"), TotItemVal: round(line.line_total),
    };
  });
  const sum = (key) => round(items.reduce((total, item) => total + item[key], 0));
  return {
    seller,
    payload: {
      Version: "1.1",
      TranDtls: { TaxSch: "GST", SupTyp: exportSupply ? (invoice.supply_type === "sez" ? "SEZWP" : "EXPWP") : "B2B", RegRev: invoice.reverse_charge ? "Y" : "N" },
      DocDtls: { Typ: "INV", No: invoice.invoice_number, Dt: indianDate(invoice.invoice_date) },
      SellerDtls: { Gstin: seller.registration_number, LglNm: seller.legal_name || seller.name, Addr1: seller.address_line1 ?? seller.name, Loc: seller.city ?? seller.name, Pin: pin(seller.postal_code), Stcd: seller.state_code },
      BuyerDtls: { Gstin: customer.gstin ?? "URP", LglNm: customer.legalName ?? customer.displayName ?? customer.display_name ?? "Customer", Pos: invoice.place_of_supply ?? billing.stateCode ?? seller.state_code,
        Addr1: billing.line1 ?? billing.addressLine1 ?? billing.address_line1 ?? "-", Loc: billing.city ?? "-", Pin: pin(billing.postalCode ?? billing.postal_code), Stcd: billing.stateCode ?? billing.state_code ?? invoice.place_of_supply },
      ItemList: items,
      ValDtls: { AssVal: sum("AssAmt"), CgstVal: sum("CgstAmt"), SgstVal: sum("SgstAmt"), IgstVal: sum("IgstAmt"), CesVal: sum("CesAmt"), RndOffAmt: round(invoice.rounding_adjustment ?? 0),
        TotInvVal: round(invoice.grand_total) },
    },
    invoice,
  };
}

const einvoiceView = (row) => row && ({ id: row.id, documentNumber: row.document_number, irn: row.irn, ackNumber: row.ack_number, ackDate: row.ack_date, signedQr: row.signed_qr,
  status: row.status, error: row.error, cancelReason: row.cancel_reason, cancelledAt: row.cancelled_at, createdAt: row.created_at });

export async function getEInvoice(client, session, invoiceId) {
  if (!UUID.test(String(invoiceId ?? ""))) return null;
  return einvoiceView((await client.query(`SELECT * FROM tenant.einvoice_documents WHERE organization_id = $1 AND document_id = $2 ORDER BY created_at DESC LIMIT 1`,
    [session.organizationId, invoiceId])).rows[0]);
}

// Generates the IRN of a posted B2B invoice (once; a live IRN is returned as it is).
export async function generateEInvoice(client, session, invoiceId, options = {}) {
  need(session, "sales.invoice.post", "You do not have permission to issue e-invoices.");
  const existing = (await client.query(`SELECT * FROM tenant.einvoice_documents WHERE organization_id = $1 AND document_id = $2 AND status = 'generated'`, [session.organizationId, invoiceId])).rows[0];
  if (existing) return { einvoice: einvoiceView(existing), replayed: true };
  const { seller, payload, invoice } = await buildEInvoicePayload(client, session, invoiceId);
  if (invoice.status !== "posted") throw new ComplianceError(409, "Post the invoice before its e-invoice is generated.", "EINVOICE_NOT_POSTED");
  if (seller.registration_type === "composition") throw new ComplianceError(409, "A composition dealer issues bills of supply, which have no IRN.", "EINVOICE_NOT_APPLICABLE");
  if (payload.TranDtls.SupTyp === "B2B" && payload.BuyerDtls.Gstin === "URP") throw new ComplianceError(409, "The customer has no GSTIN: a B2C invoice needs no IRN.", "EINVOICE_NOT_APPLICABLE");
  let answer;
  try {
    answer = await gsp("einvoice/generate", { gstin: seller.registration_number, invoice: payload }, options);
  } catch (error) {
    if (error.code === "GSP_REFUSED" || error.code === "GSP_UNREACHABLE") {
      await client.query(
        `INSERT INTO tenant.einvoice_documents (organization_id, document_type, document_id, document_number, seller_gstin, status, error, payload, created_by)
         VALUES ($1, 'invoice', $2, $3, $4, 'failed', $5, $6::jsonb, $7)`,
        [session.organizationId, invoiceId, invoice.invoice_number, seller.registration_number, error.message.slice(0, 500), JSON.stringify(payload), session.userId ?? null]);
      await client.query(`UPDATE tenant.accounting_customer_invoices SET e_invoice_status = 'failed' WHERE organization_id = $1 AND id = $2`, [session.organizationId, invoiceId]);
    }
    throw error;
  }
  const row = (await client.query(
    `INSERT INTO tenant.einvoice_documents (organization_id, document_type, document_id, document_number, seller_gstin, irn, ack_number, ack_date, signed_qr, signed_invoice, status, payload, created_by)
     VALUES ($1, 'invoice', $2, $3, $4, $5, $6, $7, $8, $9, 'generated', $10::jsonb, $11) RETURNING *`,
    [session.organizationId, invoiceId, invoice.invoice_number, seller.registration_number, answer.irn, answer.ackNo ?? null, answer.ackDate ?? new Date(), answer.signedQrCode ?? null,
      answer.signedInvoice ?? null, JSON.stringify(payload), session.userId ?? null])).rows[0];
  await client.query(`UPDATE tenant.accounting_customer_invoices SET e_invoice_status = 'generated', e_invoice_reference = $3 WHERE organization_id = $1 AND id = $2`,
    [session.organizationId, invoiceId, answer.irn]);
  return { einvoice: einvoiceView(row), replayed: false };
}

const CANCEL_REASONS = Object.freeze({ duplicate: "1", data_entry_mistake: "2", order_cancelled: "3", other: "4" });
// Cancels an IRN, within 24 hours of its acknowledgement (the IRP refuses later; then issue a credit note).
export async function cancelEInvoice(client, session, invoiceId, { reason = "data_entry_mistake", remarks = "" } = {}, options = {}) {
  need(session, "sales.invoice.post", "You do not have permission to cancel e-invoices.");
  const row = (await client.query(`SELECT * FROM tenant.einvoice_documents WHERE organization_id = $1 AND document_id = $2 AND status = 'generated' FOR UPDATE`, [session.organizationId, invoiceId])).rows[0];
  if (!row) throw new ComplianceError(404, "This invoice has no live e-invoice.", "EINVOICE_NOT_FOUND");
  if (Date.now() - new Date(row.ack_date).getTime() > 24 * 3600 * 1000) throw new ComplianceError(409, "An IRN can be cancelled only within 24 hours. Issue a credit note instead.", "EINVOICE_CANCEL_WINDOW_PASSED");
  const code = CANCEL_REASONS[reason];
  if (!code) throw new ComplianceError(400, "Choose why the e-invoice is cancelled.", "EINVOICE_CANCEL_REASON");
  const note = String(remarks ?? "").trim().slice(0, 100) || reason.replace(/_/g, " ");
  await gsp("einvoice/cancel", { gstin: row.seller_gstin, irn: row.irn, reason: code, remarks: note }, options);
  const updated = (await client.query(`UPDATE tenant.einvoice_documents SET status = 'cancelled', cancel_reason = $2, cancelled_at = now(), updated_at = now() WHERE id = $1 RETURNING *`, [row.id, note])).rows[0];
  await client.query(`UPDATE tenant.accounting_customer_invoices SET e_invoice_status = 'cancelled' WHERE organization_id = $1 AND id = $2`, [session.organizationId, invoiceId]);
  return { einvoice: einvoiceView(updated) };
}

// ------------------------------------------------------------------ e-way bills
const TRANSPORT_MODES = Object.freeze({ road: "1", rail: "2", air: "3", ship: "4" });
const SOURCE_PERMISSION = Object.freeze({ sales_delivery: "sales.delivery.dispatch", stock_transfer: "stock.transfers.dispatch", purchase_return: "procurement.returns.post",
  sales_invoice: "sales.invoice.post" });

// What the movement carries: number, date, the two parties' GSTIN/addresses, the goods with HSN, UQC, value and GST rates.
export async function movementOf(client, organizationId, sourceType, sourceId) {
  const uqcOf = await unitUqcMap(client, organizationId);
  const uqc = (code) => uqcOf.get(String(code ?? "").toUpperCase()) ?? "OTH";
  const registrationOf = async (registrationId) => sellerRegistration(client, organizationId, registrationId);
  if (sourceType === "sales_delivery") {
    const delivery = (await client.query(
      `SELECT delivery.*, warehouse.address_line1 AS w_line1, warehouse.city AS w_city, warehouse.postal_code AS w_pin, warehouse.state_code AS w_state, warehouse.tax_registration_id
         FROM tenant.sales_fulfillment_requests delivery LEFT JOIN tenant.warehouses warehouse ON warehouse.organization_id = delivery.organization_id AND warehouse.id = delivery.warehouse_id
        WHERE delivery.organization_id = $1 AND delivery.id = $2`, [organizationId, sourceId])).rows[0];
    if (!delivery) throw new ComplianceError(404, "Delivery not found.", "EWAY_SOURCE_NOT_FOUND");
    const lines = (await client.query(
      `SELECT line.item_name_snapshot, line.quantity, line.uom_snapshot, order_line.hsn_sac_snapshot, order_line.tax_rate,
              CASE WHEN order_line.quantity > 0 THEN order_line.taxable_amount / order_line.quantity * line.quantity ELSE 0 END AS taxable
         FROM tenant.sales_delivery_lines line LEFT JOIN tenant.sales_order_lines order_line ON order_line.organization_id = line.organization_id AND order_line.id = line.sales_order_line_id
        WHERE line.organization_id = $1 AND line.delivery_id = $2 ORDER BY line.sequence`, [organizationId, sourceId])).rows;
    const seller = await registrationOf(delivery.tax_registration_id);
    const customer = delivery.customer_snapshot ?? {};
    const ship = delivery.shipping_address_snapshot ?? {};
    const interState = (ship.stateCode ?? ship.state_code) && seller?.state_code && (ship.stateCode ?? ship.state_code) !== seller.state_code;
    return {
      number: delivery.request_number, date: delivery.dispatch_date ?? delivery.created_at ?? new Date(), seller, supplyType: "O", subSupplyType: "1", docType: "CHL",
      from: { line1: delivery.w_line1, city: delivery.w_city, pin: delivery.w_pin, state: delivery.w_state ?? seller?.state_code },
      to: { gstin: customer.gstin ?? "URP", name: customer.legalName ?? customer.displayName ?? "Customer", line1: ship.line1 ?? ship.addressLine1, city: ship.city, pin: ship.postalCode ?? ship.postal_code, state: ship.stateCode ?? ship.state_code },
      items: lines.map((line) => ({ name: line.item_name_snapshot, hsn: line.hsn_sac_snapshot, quantity: Number(line.quantity), unit: uqc(line.uom_snapshot), taxable: round(line.taxable), rate: Number(line.tax_rate ?? 0) })),
      interState, vehicle: delivery.vehicle_reference,
    };
  }
  // A posted tax invoice (Sales audit M2): its goods (not services or charges), from the issuing registration's address to the shipping address.
  if (sourceType === "sales_invoice") {
    const invoice = (await client.query(
      `SELECT invoice.*, sales.seller_registration_id, sales.shipping_address_snapshot, sales.customer_snapshot AS sales_customer
         FROM tenant.accounting_customer_invoices invoice
         LEFT JOIN tenant.sales_invoices sales ON sales.organization_id = invoice.organization_id AND sales.customer_invoice_id = invoice.id
        WHERE invoice.organization_id = $1 AND invoice.id = $2 AND invoice.invoice_type = 'invoice'`, [organizationId, sourceId])).rows[0];
    if (!invoice) throw new ComplianceError(404, "Invoice not found.", "EWAY_SOURCE_NOT_FOUND");
    if (!invoice.posted_at || ["cancelled", "reversed", "void"].includes(invoice.status))
      throw new ComplianceError(409, "Post the invoice first: an e-way bill is made from a posted tax invoice.", "EWAY_SOURCE_NOT_POSTED");
    const lines = (await client.query(
      `SELECT line.description, line.hsn_sac_code, line.quantity, line.net_amount, sales_line.uom_snapshot, sales_line.tax_rate
         FROM tenant.accounting_customer_invoice_lines line
         LEFT JOIN tenant.sales_invoice_lines sales_line ON sales_line.organization_id = line.organization_id AND sales_line.customer_invoice_line_id = line.id
         LEFT JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
        WHERE line.organization_id = $1 AND line.customer_invoice_id = $2 AND line.item_id IS NOT NULL AND sales_line.order_charge_id IS NULL
          AND COALESCE(sales_line.hsn_sac_kind, CASE WHEN item.item_type = 'service' THEN 'sac' ELSE 'hsn' END) <> 'sac'
        ORDER BY line.sequence`, [organizationId, sourceId])).rows;
    const seller = await registrationOf(invoice.seller_registration_id);
    const customer = invoice.sales_customer ?? invoice.customer_snapshot ?? {};
    const ship = invoice.shipping_address_snapshot && Object.keys(invoice.shipping_address_snapshot).length ? invoice.shipping_address_snapshot : invoice.billing_address_snapshot ?? {};
    const shipState = ship.stateCode ?? ship.state_code;
    return {
      number: invoice.invoice_number, date: invoice.invoice_date, seller, supplyType: "O", subSupplyType: "1", docType: "INV",
      from: { line1: seller?.address_line1, city: seller?.city, pin: seller?.postal_code, state: seller?.state_code },
      to: { gstin: customer.gstin ?? "URP", name: customer.legalName ?? customer.displayName ?? "Customer", line1: ship.line1 ?? ship.addressLine1, city: ship.city,
        pin: ship.postalCode ?? ship.postal_code, state: shipState },
      items: lines.map((line) => ({ name: line.description, hsn: line.hsn_sac_code, quantity: Number(line.quantity), unit: uqc(line.uom_snapshot), taxable: round(line.net_amount), rate: Number(line.tax_rate ?? 0) })),
      interState: shipState && seller?.state_code && shipState !== seller.state_code, vehicle: null,
    };
  }
  if (sourceType === "stock_transfer") {
    const transfer = (await client.query(
      `SELECT transfer.*, source.address_line1 AS s_line1, source.city AS s_city, source.postal_code AS s_pin, source.state_code AS s_state, source.tax_registration_id AS s_reg,
              destination.address_line1 AS d_line1, destination.city AS d_city, destination.postal_code AS d_pin, destination.state_code AS d_state, destination.tax_registration_id AS d_reg, destination.name AS d_name
         FROM tenant.inventory_transfers transfer
         JOIN tenant.warehouses source ON source.organization_id = transfer.organization_id AND source.id = transfer.source_warehouse_id
         JOIN tenant.warehouses destination ON destination.organization_id = transfer.organization_id AND destination.id = transfer.destination_warehouse_id
        WHERE transfer.organization_id = $1 AND transfer.id = $2`, [organizationId, sourceId])).rows[0];
    if (!transfer) throw new ComplianceError(404, "Transfer not found.", "EWAY_SOURCE_NOT_FOUND");
    const lines = (await client.query(
      `SELECT item.name, item.hsn_sac_code, line.quantity, uom.code AS uom, COALESCE(item.standard_cost, item.purchase_price, 0) * line.base_quantity AS taxable
         FROM tenant.inventory_transfer_lines line JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
         LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = line.organization_id AND uom.id = line.uom_id
        WHERE line.organization_id = $1 AND line.transfer_id = $2 ORDER BY line.line_number`, [organizationId, sourceId])).rows;
    const seller = await registrationOf(transfer.s_reg);
    const receiver = await registrationOf(transfer.d_reg ?? transfer.s_reg);
    return {
      number: transfer.document_number, date: transfer.dispatch_date ?? transfer.transfer_date, seller, supplyType: "O", subSupplyType: "8", subSupplyDesc: "Branch transfer", docType: "CHL",
      from: { line1: transfer.s_line1, city: transfer.s_city, pin: transfer.s_pin, state: transfer.s_state ?? seller?.state_code },
      to: { gstin: receiver?.registration_number ?? seller?.registration_number, name: transfer.d_name, line1: transfer.d_line1, city: transfer.d_city, pin: transfer.d_pin, state: transfer.d_state },
      items: lines.map((line) => ({ name: line.name, hsn: line.hsn_sac_code, quantity: Number(line.quantity), unit: uqc(line.uom), taxable: round(line.taxable), rate: 0 })),
      interState: transfer.s_state && transfer.d_state && transfer.s_state !== transfer.d_state, vehicle: transfer.vehicle_number,
    };
  }
  if (sourceType === "purchase_return") {
    const ret = (await client.query(`SELECT * FROM tenant.purchase_returns WHERE organization_id = $1 AND id = $2`, [organizationId, sourceId])).rows[0];
    if (!ret) throw new ComplianceError(404, "Purchase return not found.", "EWAY_SOURCE_NOT_FOUND");
    const lines = (await client.query(
      `SELECT COALESCE(line.description, line.product_snapshot->>'name', 'Item') AS name, order_line.hsn_sac_code, line.quantity, line.uom_snapshot, order_line.tax_rate,
              COALESCE(order_line.unit_price, 0) * line.quantity AS taxable
         FROM tenant.purchase_return_lines line LEFT JOIN tenant.purchase_order_lines order_line ON order_line.organization_id = line.organization_id AND order_line.id = line.purchase_order_line_id
        WHERE line.organization_id = $1 AND line.purchase_return_id = $2 ORDER BY line.line_number`, [organizationId, sourceId])).rows;
    const seller = await registrationOf(ret.buying_registration_id);
    const supplier = ret.supplier_snapshot ?? {};
    const address = ret.return_to_address_snapshot ?? {};
    return {
      number: ret.return_number, date: ret.dispatched_at ?? ret.return_date, seller, supplyType: "O", subSupplyType: "8", subSupplyDesc: "Purchase return", docType: "CHL",
      from: { line1: seller?.address_line1, city: seller?.city, pin: seller?.postal_code, state: seller?.state_code },
      to: { gstin: supplier.gstin ?? "URP", name: supplier.legalName ?? supplier.supplierName ?? supplier.name ?? "Supplier", line1: address.line1, city: address.city, pin: address.postalCode ?? address.postal_code,
        state: address.stateCode ?? address.state_code },
      items: lines.map((line) => ({ name: line.name, hsn: line.hsn_sac_code, quantity: Number(line.quantity), unit: uqc(line.uom_snapshot), taxable: round(line.taxable), rate: Number(line.tax_rate ?? 0) })),
      interState: (address.stateCode ?? address.state_code) && seller?.state_code && (address.stateCode ?? address.state_code) !== seller.state_code, vehicle: ret.dispatch_reference,
    };
  }
  throw new ComplianceError(400, "Choose an invoice, delivery, transfer or purchase return.", "EWAY_SOURCE_INVALID");
}

export function buildEwayBillPayload(movement, { transportMode = "road", vehicleNumber = null, transporterId = null, transporterDocument = null, distanceKm = 0 } = {}) {
  const items = movement.items.map((item) => {
    const tax = round(item.taxable * item.rate / 100);
    return { productName: String(item.name ?? "Item").slice(0, 100), hsnCode: String(item.hsn ?? "").slice(0, 8), quantity: item.quantity, qtyUnit: item.unit, taxableAmount: item.taxable,
      cgstRate: movement.interState ? 0 : item.rate / 2, sgstRate: movement.interState ? 0 : item.rate / 2, igstRate: movement.interState ? item.rate : 0, cessRate: 0, tax };
  });
  const taxable = round(items.reduce((total, item) => total + item.taxableAmount, 0));
  const tax = round(items.reduce((total, item) => total + item.tax, 0));
  return {
    supplyType: movement.supplyType, subSupplyType: movement.subSupplyType, subSupplyDesc: movement.subSupplyDesc ?? "", docType: movement.docType, docNo: movement.number, docDate: indianDate(movement.date),
    fromGstin: movement.seller?.registration_number, fromTrdName: movement.seller?.legal_name || movement.seller?.name, fromAddr1: movement.from.line1 ?? "", fromPlace: movement.from.city ?? "",
    fromPincode: pin(movement.from.pin), fromStateCode: Number(movement.from.state ?? 0), actFromStateCode: Number(movement.from.state ?? 0),
    toGstin: movement.to.gstin ?? "URP", toTrdName: movement.to.name ?? "", toAddr1: movement.to.line1 ?? "", toPlace: movement.to.city ?? "", toPincode: pin(movement.to.pin),
    toStateCode: Number(movement.to.state ?? 0), actToStateCode: Number(movement.to.state ?? 0),
    totalValue: taxable, cgstValue: movement.interState ? 0 : round(tax / 2), sgstValue: movement.interState ? 0 : round(tax / 2), igstValue: movement.interState ? tax : 0, cessValue: 0,
    totInvValue: round(taxable + tax), transMode: TRANSPORT_MODES[transportMode] ?? "1", transDistance: String(Math.max(0, Math.trunc(Number(distanceKm) || 0))),
    transporterId: transporterId ?? "", transDocNo: transporterDocument ?? "", vehicleNo: vehicleNumber ? String(vehicleNumber).toUpperCase().replace(/[\s-]/g, "") : "", vehicleType: vehicleNumber ? "R" : "",
    itemList: items.map(({ tax: _tax, ...item }) => item),
  };
}

const ewayView = (row) => row && ({ id: row.id, sourceType: row.source_type, sourceId: row.source_id, sourceNumber: row.source_number, ewbNumber: row.ewb_number, ewbDate: row.ewb_date,
  validUntil: row.valid_until, status: row.status, vehicleNumber: row.vehicle_number, transportMode: row.transport_mode, distanceKm: row.distance_km, error: row.error,
  cancelReason: row.cancel_reason, cancelledAt: row.cancelled_at, partBUpdatedAt: row.part_b_updated_at });

export async function getEwayBill(client, session, sourceType, sourceId) {
  if (!UUID.test(String(sourceId ?? ""))) return null;
  return ewayView((await client.query(`SELECT * FROM tenant.eway_bills WHERE organization_id = $1 AND source_type = $2 AND source_id = $3 ORDER BY created_at DESC LIMIT 1`,
    [session.organizationId, sourceType, sourceId])).rows[0]);
}

// input: { transportMode, vehicleNumber, transporterId, transporterDocument, distanceKm, voluntary }
export async function generateEwayBill(client, session, sourceType, sourceId, input = {}, options = {}) {
  const permission = SOURCE_PERMISSION[sourceType];
  if (!permission) throw new ComplianceError(400, "Choose an invoice, delivery, transfer or purchase return.", "EWAY_SOURCE_INVALID");
  need(session, permission, "You do not have permission to generate e-way bills for this movement.");
  if (!UUID.test(String(sourceId ?? ""))) throw new ComplianceError(404, "Not found.", "EWAY_SOURCE_NOT_FOUND");
  const live = (await client.query(`SELECT * FROM tenant.eway_bills WHERE organization_id = $1 AND source_type = $2 AND source_id = $3 AND status = 'generated'`, [session.organizationId, sourceType, sourceId])).rows[0];
  if (live) return { ewayBill: ewayView(live), replayed: true };
  const movement = await movementOf(client, session.organizationId, sourceType, sourceId);
  if (!movement.seller?.registration_number) throw new ComplianceError(409, "The sending warehouse or company has no GSTIN.", "EWAY_NO_GSTIN");
  const distance = Number(input.distanceKm ?? 0);
  if (!Number.isInteger(distance) || distance < 0 || distance > 4000) throw new ComplianceError(400, "Enter the distance in kilometres (0 to 4,000).", "EWAY_INVALID", { field: "distanceKm" });
  if (input.transportMode && !TRANSPORT_MODES[input.transportMode]) throw new ComplianceError(400, "Choose road, rail, air or ship.", "EWAY_INVALID", { field: "transportMode" });
  const payload = buildEwayBillPayload(movement, { ...input, distanceKm: distance });
  if (payload.totInvValue < EWAY_BILL_THRESHOLD && !input.voluntary)
    throw new ComplianceError(409, `The consignment is worth ₹${payload.totInvValue.toLocaleString("en-IN")}, under ₹50,000: no e-way bill is needed (generate one anyway if the state asks).`, "EWAY_BELOW_THRESHOLD");
  const values = [session.organizationId, sourceType, sourceId, movement.number, input.transportMode ?? "road", payload.vehicleNo || null, input.transporterId ?? null, input.transporterDocument ?? null,
    distance, JSON.stringify(payload), session.userId ?? null];
  let answer;
  try {
    answer = await gsp("ewaybill/generate", { gstin: payload.fromGstin, ewaybill: payload }, options);
  } catch (error) {
    if (error.code === "GSP_REFUSED" || error.code === "GSP_UNREACHABLE")
      await client.query(
        `INSERT INTO tenant.eway_bills (organization_id, source_type, source_id, source_number, status, transport_mode, vehicle_number, transporter_id, transporter_document, distance_km, payload, created_by, error)
         VALUES ($1, $2, $3, $4, 'failed', $5, $6, $7, $8, $9, $10::jsonb, $11, $12)`, [...values, error.message.slice(0, 500)]);
    throw error;
  }
  const row = (await client.query(
    `INSERT INTO tenant.eway_bills (organization_id, source_type, source_id, source_number, status, transport_mode, vehicle_number, transporter_id, transporter_document, distance_km, payload, created_by,
       ewb_number, ewb_date, valid_until)
     VALUES ($1, $2, $3, $4, 'generated', $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14) RETURNING *`,
    [...values, String(answer.ewbNo), answer.ewbDate ?? new Date(), answer.validUpto ?? null])).rows[0];
  return { ewayBill: ewayView(row), replayed: false };
}

// Part B: the vehicle carrying the goods (or a change of vehicle on the way).
export async function updateEwayBillVehicle(client, session, ewayBillId, { vehicleNumber, reason = "first_time", fromPlace = "", transportMode = "road" } = {}, options = {}) {
  const row = (await client.query(`SELECT * FROM tenant.eway_bills WHERE organization_id = $1 AND id = $2 AND status = 'generated' FOR UPDATE`, [session.organizationId, UUID.test(String(ewayBillId)) ? ewayBillId : null])).rows[0];
  if (!row) throw new ComplianceError(404, "No live e-way bill.", "EWAY_NOT_FOUND");
  need(session, SOURCE_PERMISSION[row.source_type], "You do not have permission to update this e-way bill.");
  const vehicle = String(vehicleNumber ?? "").toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-Z0-9]{6,12}$/.test(vehicle)) throw new ComplianceError(400, "Enter the vehicle number, such as MH12AB1234.", "EWAY_INVALID", { field: "vehicleNumber" });
  const reasons = { breakdown: "1", transhipment: "2", others: "3", first_time: "4" };
  const answer = await gsp("ewaybill/update-part-b", { gstin: row.payload.fromGstin, ewbNo: row.ewb_number, vehicleNo: vehicle, reasonCode: reasons[reason] ?? "3", reasonRem: reason.replace(/_/g, " "),
    fromPlace: fromPlace || row.payload.fromPlace, fromState: row.payload.fromStateCode, transMode: TRANSPORT_MODES[transportMode] ?? "1" }, options);
  const updated = (await client.query(`UPDATE tenant.eway_bills SET vehicle_number = $2, transport_mode = $3, part_b_updated_at = now(), valid_until = COALESCE($4, valid_until), updated_at = now() WHERE id = $1 RETURNING *`,
    [row.id, vehicle, transportMode, answer.validUpto ?? null])).rows[0];
  return { ewayBill: ewayView(updated) };
}

// Cancel within 24 hours of generation (goods not moved, wrong details).
export async function cancelEwayBill(client, session, ewayBillId, { reason = "data_entry_mistake", remarks = "" } = {}, options = {}) {
  const row = (await client.query(`SELECT * FROM tenant.eway_bills WHERE organization_id = $1 AND id = $2 AND status = 'generated' FOR UPDATE`, [session.organizationId, UUID.test(String(ewayBillId)) ? ewayBillId : null])).rows[0];
  if (!row) throw new ComplianceError(404, "No live e-way bill.", "EWAY_NOT_FOUND");
  need(session, SOURCE_PERMISSION[row.source_type], "You do not have permission to cancel this e-way bill.");
  if (Date.now() - new Date(row.ewb_date).getTime() > 24 * 3600 * 1000) throw new ComplianceError(409, "An e-way bill can be cancelled only within 24 hours of generation.", "EWAY_CANCEL_WINDOW_PASSED");
  const codes = { duplicate: "1", order_cancelled: "2", data_entry_mistake: "3", others: "4" };
  const note = String(remarks ?? "").trim().slice(0, 100) || reason.replace(/_/g, " ");
  await gsp("ewaybill/cancel", { gstin: row.payload.fromGstin, ewbNo: row.ewb_number, reason: codes[reason] ?? "4", remarks: note }, options);
  const updated = (await client.query(`UPDATE tenant.eway_bills SET status = 'cancelled', cancel_reason = $2, cancelled_at = now(), updated_at = now() WHERE id = $1 RETURNING *`, [row.id, note])).rows[0];
  return { ewayBill: ewayView(updated) };
}
