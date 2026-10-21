// GST — e-invoice and e-way-bill obligations (MVP 43). "Ready" data is not a generated e-invoice: this checks a document's data against
// what the IRP / e-way-bill system needs before anything is generated, lists what the company must still generate (posted invoices of
// GSTINs under the e-invoice mandate without an IRN; movements of goods over ₹50,000 without a live e-way bill), and — where the IRN or
// e-way bill was generated on the government portal instead of through a connected GSP — records that reference against the document, so
// the obligation is tracked either way. Generation through a GSP stays in orchestration/compliance.
import { hasSessionPermission } from "../../core/access/index.js";
import { validateGstin } from "../../core/invoicing/index.js";
import { EWAY_BILL_THRESHOLD, buildEwayBillPayload, gspConfigured, movementOf } from "../../orchestration/compliance/index.js";
import { GST_PERMISSIONS as P, GstError, defaultRegistrationId, need, paise, rupees, text, uuid, ymd } from "./gst-common.js";
import { checkDocument, collectOutward } from "./gst-outward.js";

const IRN = /^[0-9a-f]{64}$/i;
const EWB = /^\d{12}$/;
const PIN = /^[1-9]\d{5}$/;
const EWAY_PERMISSION = Object.freeze({ sales_delivery: "sales.delivery.dispatch", stock_transfer: "stock.transfers.dispatch", purchase_return: "procurement.returns.post",
  sales_invoice: "sales.invoice.post" });
const sessionNeed = (c, permission, message) => { if (!hasSessionPermission(c, permission)) throw new GstError(403, message, "GST_FORBIDDEN"); };

async function invoiceOf(client, c, invoiceId) {
  const row = (await client.query(`SELECT i.*, si.seller_registration_id FROM tenant.accounting_customer_invoices i LEFT JOIN tenant.sales_invoices si ON si.customer_invoice_id = i.id
    WHERE i.organization_id = $1 AND i.id = $2`, [c.organizationId, uuid(invoiceId, "Invoice")])).rows[0];
  if (!row) throw new GstError(404, "That invoice was not found.", "GST_NOT_FOUND");
  const registrationId = row.seller_registration_id ?? await defaultRegistrationId(client, c);
  const registration = registrationId ? (await client.query(`SELECT * FROM tenant.tax_registrations WHERE organization_id = $1 AND id = $2`, [c.organizationId, registrationId])).rows[0] : null;
  return { invoice: row, registration };
}
// Whether the invoice falls under e-invoicing: the seller GSTIN is under the mandate on the invoice date, it is a regular registration, and
// the supply is to a registered buyer, an SEZ or an export.
function applicability(invoice, registration) {
  if (!registration?.registration_number) return { applicable: false, why: "The selling registration has no GSTIN." };
  if (!registration.einvoice_applicable) return { applicable: false, why: `${registration.registration_number} is not marked as under the e-invoice mandate (Settings › Taxes).` };
  if (registration.einvoice_applicable_from && ymd(invoice.invoice_date) < ymd(registration.einvoice_applicable_from)) return { applicable: false, why: `E-invoicing applies to ${registration.registration_number} from ${ymd(registration.einvoice_applicable_from)}.` };
  if (registration.registration_type && registration.registration_type !== "regular") return { applicable: false, why: "A composition or special registration issues no e-invoice." };
  const b2b = Boolean(String(invoice.customer_snapshot?.gstin ?? "").trim()) || ["export", "sez"].includes(invoice.supply_type);
  if (!b2b) return { applicable: false, why: "A sale to an unregistered buyer (B2C) needs no IRN." };
  return { applicable: true, why: null };
}

// The data check before an IRN is generated (here through the GSP, or on the portal).
export async function getEInvoiceReadiness(client, c, invoiceId) {
  if (!hasSessionPermission(c, P.view) && !hasSessionPermission(c, "sales.invoice.view")) need(c, P.view, "You do not have permission to see e-invoice readiness.");
  const { invoice, registration } = await invoiceOf(client, c, invoiceId);
  const { applicable, why } = applicability(invoice, registration);
  const problems = [];
  const add = (severity, message) => problems.push({ severity, message });
  if (!invoice.posted_at || ["cancelled", "reversed"].includes(invoice.status)) add("blocking", "Only a posted invoice gets an IRN.");
  if (registration) {
    if (!text(registration.address_line1) || !text(registration.city)) add("blocking", `The selling registration ${registration.registration_number} has no address (line 1 and city).`);
    if (!PIN.test(String(registration.postal_code ?? ""))) add("blocking", "The selling registration's PIN code is missing or not 6 digits.");
  }
  const buyer = invoice.billing_address_snapshot ?? {};
  const gstin = String(invoice.customer_snapshot?.gstin ?? "").trim().toUpperCase();
  if (gstin && !validateGstin(gstin).valid) add("blocking", `The customer's GSTIN ${gstin} is not valid.`);
  if (invoice.supply_type !== "export") {
    if (!PIN.test(String(buyer.postalCode ?? buyer.postal_code ?? ""))) add("blocking", "The billing address has no valid 6-digit PIN code.");
    if (!text(buyer.line1 ?? buyer.addressLine1 ?? buyer.address_line1)) add("blocking", "The billing address has no first line.");
  }
  if (registration) {
    const { documents, sellerState } = await collectOutward(client, c, registration, ymd(invoice.invoice_date), ymd(invoice.invoice_date), { sourceIds: [invoice.id] });
    const doc = documents[0];
    if (doc) {
      for (const x of checkDocument(doc, registration, { sellerState }).filter((p) => p.code !== "EINVOICE_MISSING")) add(x.severity, x.message);
      for (const [n, l] of doc.lines.entries()) if (l.goods && l.uqc === "OTH") add("warning", `Line ${n + 1}: the unit has no GST unit code (UQC); OTH will be reported.`);
    }
  }
  const live = (await client.query(`SELECT irn, ack_number, ack_date, origin FROM tenant.einvoice_documents WHERE organization_id = $1 AND document_id = $2 AND status = 'generated'`, [c.organizationId, invoice.id])).rows[0] ?? null;
  return { invoiceId: invoice.id, number: invoice.invoice_number, applicable, why, ready: applicable && !problems.some((p) => p.severity === "blocking"), problems, live,
    gspConfigured: gspConfigured(process.env),
    meaning: "Ready means the data meets the IRP's requirements. It is not an e-invoice until an IRN is generated (through the GSP or on the portal) and recorded here." };
}

// An IRN generated on the e-invoice portal (IRP) for this invoice: its 64-character IRN, acknowledgement number and date.
export async function recordPortalEInvoice(client, c, invoiceId, input = {}) {
  sessionNeed(c, "sales.invoice.post", "You do not have permission to record e-invoices.");
  const { invoice, registration } = await invoiceOf(client, c, invoiceId);
  const irn = text(input.irn, 64).toLowerCase();
  if (!IRN.test(irn)) throw new GstError(400, "The IRN is the 64-character code the portal returned.", "EINVOICE_INVALID");
  const ack = text(input.ackNumber, 20);
  if (!/^\d{12,20}$/.test(ack)) throw new GstError(400, "Enter the acknowledgement number (digits only).", "EINVOICE_INVALID");
  const ackDate = input.ackDate ? new Date(String(input.ackDate)) : null;
  if (!ackDate || Number.isNaN(ackDate.getTime()) || ackDate.getTime() > Date.now() + 60_000) throw new GstError(400, "Enter the acknowledgement date and time.", "EINVOICE_INVALID");
  if (!invoice.posted_at || ["cancelled", "reversed"].includes(invoice.status)) throw new GstError(409, "Only a posted invoice gets an IRN.", "EINVOICE_NOT_POSTED");
  if (!applicability(invoice, registration).applicable && !input.voluntary) throw new GstError(409, `${applicability(invoice, registration).why} Record it anyway only if one was generated.`, "EINVOICE_NOT_APPLICABLE");
  try {
    const row = (await client.query(`INSERT INTO tenant.einvoice_documents (organization_id, document_type, document_id, document_number, seller_gstin, irn, ack_number, ack_date, signed_qr, status, origin,
        recorded_note, payload, created_by) VALUES ($1, 'invoice', $2, $3, $4, $5, $6, $7, $8, 'generated', 'external', $9, '{}'::jsonb, $10) RETURNING *`,
      [c.organizationId, invoice.id, invoice.invoice_number, registration?.registration_number ?? null, irn, ack, ackDate.toISOString(), text(input.signedQr, 4000) || null,
        text(input.note, 300) || "Generated on the e-invoice portal", c.userId ?? null])).rows[0];
    await client.query(`UPDATE tenant.accounting_customer_invoices SET e_invoice_status = 'generated', e_invoice_reference = $3 WHERE organization_id = $1 AND id = $2`, [c.organizationId, invoice.id, irn]);
    return { id: row.id, irn: row.irn, ackNumber: row.ack_number, ackDate: row.ack_date, origin: row.origin, status: row.status };
  } catch (error) {
    if (error.code === "23505") throw new GstError(409, "This invoice already has a live IRN.", "EINVOICE_EXISTS");
    throw error;
  }
}
// The IRN was cancelled on the portal (possible within 24 hours of its acknowledgement; later, a credit note corrects the invoice).
export async function recordPortalEInvoiceCancellation(client, c, invoiceId, input = {}) {
  sessionNeed(c, "sales.invoice.post", "You do not have permission to record e-invoices.");
  const row = (await client.query(`SELECT * FROM tenant.einvoice_documents WHERE organization_id = $1 AND document_id = $2 AND status = 'generated' FOR UPDATE`, [c.organizationId, uuid(invoiceId, "Invoice")])).rows[0];
  if (!row) throw new GstError(404, "This invoice has no live IRN.", "EINVOICE_NOT_FOUND");
  if (Date.now() - new Date(row.ack_date).getTime() > 24 * 3600 * 1000) throw new GstError(409, "An IRN can be cancelled only within 24 hours of its acknowledgement. Issue a credit note instead.", "EINVOICE_CANCEL_WINDOW_PASSED");
  const reason = text(input.reason, 100);
  if (!reason) throw new GstError(400, "Say why the IRN was cancelled.", "GST_REASON_REQUIRED");
  await client.query(`UPDATE tenant.einvoice_documents SET status = 'cancelled', cancel_reason = $2, cancelled_at = now(), updated_at = now() WHERE id = $1`, [row.id, `${reason} (on the portal)`]);
  await client.query(`UPDATE tenant.accounting_customer_invoices SET e_invoice_status = 'cancelled' WHERE organization_id = $1 AND id = $2`, [c.organizationId, row.document_id]);
  return { status: "cancelled" };
}

// The data check before an e-way bill is generated for a delivery, transfer or purchase return.
export async function getEwayBillReadiness(client, c, sourceType, sourceId) {
  if (!EWAY_PERMISSION[sourceType]) throw new GstError(400, "Choose an invoice, delivery, transfer or purchase return.", "EWAY_SOURCE_INVALID");
  if (!hasSessionPermission(c, P.view) && !hasSessionPermission(c, EWAY_PERMISSION[sourceType])) need(c, P.view, "You do not have permission to see e-way bill readiness.");
  const movement = await movementOf(client, c.organizationId, sourceType, uuid(sourceId, "Movement"));
  const payload = buildEwayBillPayload(movement, {});
  const problems = [];
  const add = (severity, message) => problems.push({ severity, message });
  if (!movement.seller?.registration_number) add("blocking", "The sending warehouse or company has no GSTIN.");
  if (!PIN.test(String(payload.fromPincode ?? ""))) add("blocking", "The dispatch address has no valid 6-digit PIN code.");
  if (!PIN.test(String(payload.toPincode ?? ""))) add("blocking", "The delivery address has no valid 6-digit PIN code.");
  if (!payload.fromStateCode || !payload.toStateCode) add("blocking", "A state code is missing on the dispatch or delivery address.");
  if (payload.toGstin !== "URP" && !validateGstin(payload.toGstin).valid) add("blocking", `The recipient GSTIN ${payload.toGstin} is not valid.`);
  for (const [n, item] of payload.itemList.entries()) if (!/^\d{4,8}$/.test(item.hsnCode)) add("blocking", `Item ${n + 1} (${item.productName}) has no valid HSN code.`);
  if (!payload.vehicleNo) add("warning", "No vehicle yet: Part B must be filled before the goods move.");
  const value = payload.totInvValue;
  const live = (await client.query(`SELECT ewb_number, ewb_date, valid_until, origin FROM tenant.eway_bills WHERE organization_id = $1 AND source_type = $2 AND source_id = $3 AND status = 'generated'`,
    [c.organizationId, sourceType, sourceId])).rows[0] ?? null;
  return { sourceType, sourceId, number: movement.number, value, required: value >= EWAY_BILL_THRESHOLD, ready: !problems.some((p) => p.severity === "blocking"), problems, live,
    gspConfigured: gspConfigured(process.env) };
}

// An e-way bill generated on the e-way-bill portal for this movement: its 12-digit number, date and validity.
export async function recordPortalEwayBill(client, c, sourceType, sourceId, input = {}) {
  if (!EWAY_PERMISSION[sourceType]) throw new GstError(400, "Choose an invoice, delivery, transfer or purchase return.", "EWAY_SOURCE_INVALID");
  sessionNeed(c, EWAY_PERMISSION[sourceType], "You do not have permission to record e-way bills for this movement.");
  const number = text(input.ewbNumber, 12);
  if (!EWB.test(number)) throw new GstError(400, "The e-way bill number is 12 digits.", "EWAY_INVALID");
  const date = input.ewbDate ? new Date(String(input.ewbDate)) : null;
  const until = input.validUntil ? new Date(String(input.validUntil)) : null;
  if (!date || Number.isNaN(date.getTime()) || date.getTime() > Date.now() + 60_000) throw new GstError(400, "Enter when the e-way bill was generated.", "EWAY_INVALID");
  if (!until || Number.isNaN(until.getTime()) || until <= date) throw new GstError(400, "Enter its validity (after the generation time).", "EWAY_INVALID");
  const movement = await movementOf(client, c.organizationId, sourceType, uuid(sourceId, "Movement"));
  const vehicle = text(input.vehicleNumber, 15).toUpperCase().replace(/[\s-]/g, "") || null;
  if (vehicle && !/^[A-Z0-9]{6,12}$/.test(vehicle)) throw new GstError(400, "Enter the vehicle number, such as MH12AB1234.", "EWAY_INVALID");
  try {
    const row = (await client.query(`INSERT INTO tenant.eway_bills (organization_id, source_type, source_id, source_number, ewb_number, ewb_date, valid_until, status, transport_mode, vehicle_number,
        distance_km, payload, origin, recorded_note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'generated',$8,$9,$10,'{}'::jsonb,'external',$11,$12) RETURNING *`,
      [c.organizationId, sourceType, sourceId, movement.number, number, date.toISOString(), until.toISOString(), ["road", "rail", "air", "ship"].includes(input.transportMode) ? input.transportMode : "road",
        vehicle, Math.max(0, Math.trunc(Number(input.distanceKm) || 0)), text(input.note, 300) || "Generated on the e-way bill portal", c.userId ?? null])).rows[0];
    return { id: row.id, ewbNumber: row.ewb_number, validUntil: row.valid_until, origin: row.origin, status: row.status };
  } catch (error) {
    if (error.code === "23505") throw new GstError(409, "This movement already has a live e-way bill.", "EWAY_EXISTS");
    throw error;
  }
}

// What is still owed: invoices that need an IRN and have none, movements of goods worth ₹50,000 or more without a live e-way bill, and
// live e-way bills that expire within a day.
export async function listGstDocumentObligations(client, c, input = {}) {
  need(c, P.view, "You do not have permission to see GST obligations.");
  const to = ymd(input.to) || ymd(new Date());
  const from = ymd(input.from) || ymd(new Date(Date.parse(`${to}T00:00:00Z`) - 30 * 864e5));
  const fallback = await defaultRegistrationId(client, c);
  const invoices = (await client.query(`SELECT i.id, i.invoice_number, i.invoice_type, i.invoice_date, i.grand_total, i.customer_snapshot->>'gstin' AS gstin, i.customer_snapshot->>'displayName' AS customer, r.registration_number
      FROM tenant.accounting_customer_invoices i LEFT JOIN tenant.sales_invoices si ON si.customer_invoice_id = i.id
      JOIN tenant.tax_registrations r ON r.id = COALESCE(si.seller_registration_id, $4::uuid)
      WHERE i.organization_id = $1 AND i.posted_at IS NOT NULL AND i.status NOT IN ('cancelled', 'reversed') AND i.invoice_type IN ('invoice', 'credit_note', 'debit_note')
        AND i.invoice_date BETWEEN $2 AND $3 AND r.einvoice_applicable AND (r.einvoice_applicable_from IS NULL OR i.invoice_date >= r.einvoice_applicable_from)
        AND COALESCE(r.registration_type, 'regular') = 'regular' AND (COALESCE(i.customer_snapshot->>'gstin', '') <> '' OR i.supply_type IN ('export', 'sez'))
        AND NOT EXISTS (SELECT 1 FROM tenant.einvoice_documents d WHERE d.organization_id = i.organization_id AND d.document_id = i.id AND d.status = 'generated')
      ORDER BY i.invoice_date, i.invoice_number LIMIT 500`, [c.organizationId, from, to, fallback])).rows;
  const movements = (await client.query(`SELECT 'sales_delivery' AS source_type, id, request_number AS number, COALESCE(dispatch_date, delivery_date, requested_at::date) AS day FROM tenant.sales_fulfillment_requests
        WHERE organization_id = $1 AND delivery_status IN ('ready', 'dispatched', 'delivered') AND COALESCE(dispatch_date, delivery_date, requested_at::date) BETWEEN $2 AND $3
          AND NOT EXISTS (SELECT 1 FROM tenant.eway_bills bill JOIN tenant.accounting_customer_invoices invoice ON invoice.id = bill.source_id
                           WHERE bill.organization_id = $1 AND bill.source_type = 'sales_invoice' AND bill.status = 'generated'
                             AND invoice.source_sales_order_id = sales_fulfillment_requests.sales_order_id)
      UNION ALL SELECT 'stock_transfer', id, document_number, COALESCE(dispatch_date, transfer_date) FROM tenant.inventory_transfers
        WHERE organization_id = $1 AND status IN ('dispatched', 'partially_received', 'completed') AND COALESCE(dispatch_date, transfer_date) BETWEEN $2 AND $3
      UNION ALL SELECT 'purchase_return', id, return_number, COALESCE(dispatched_at::date, return_date) FROM tenant.purchase_returns
        WHERE organization_id = $1 AND document_status = 'posted' AND COALESCE(dispatched_at::date, return_date) BETWEEN $2 AND $3
      UNION ALL SELECT 'sales_invoice', invoice.id, invoice.invoice_number, invoice.invoice_date FROM tenant.accounting_customer_invoices invoice
        WHERE invoice.organization_id = $1 AND invoice.invoice_type = 'invoice' AND invoice.posted_at IS NOT NULL AND invoice.status NOT IN ('cancelled', 'reversed', 'void')
          AND invoice.invoice_date BETWEEN $2 AND $3 AND invoice.source_sales_order_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM tenant.accounting_customer_invoice_lines line JOIN tenant.items item ON item.id = line.item_id
                       WHERE line.customer_invoice_id = invoice.id AND item.item_type <> 'service')
          AND NOT EXISTS (SELECT 1 FROM tenant.eway_bills bill JOIN tenant.sales_fulfillment_requests delivery ON delivery.id = bill.source_id
                           WHERE bill.organization_id = invoice.organization_id AND bill.source_type = 'sales_delivery' AND bill.status = 'generated'
                             AND delivery.sales_order_id = invoice.source_sales_order_id)
      ORDER BY 4 DESC LIMIT 150`, [c.organizationId, from, to])).rows;
  const live = new Set((await client.query(`SELECT source_type || ':' || source_id AS k FROM tenant.eway_bills WHERE organization_id = $1 AND status = 'generated'`, [c.organizationId])).rows.map((r) => r.k));
  const ewayDue = [];
  for (const m of movements) {
    if (live.has(`${m.source_type}:${m.id}`)) continue;
    try {
      const movement = await movementOf(client, c.organizationId, m.source_type, m.id);
      const value = buildEwayBillPayload(movement, {}).totInvValue;
      if (value >= EWAY_BILL_THRESHOLD) ewayDue.push({ sourceType: m.source_type, sourceId: m.id, number: m.number, date: ymd(m.day), value });
    } catch { /* a movement that can't be read is not listed */ }
  }
  const expiring = (await client.query(`SELECT source_type, source_id, source_number, ewb_number, valid_until FROM tenant.eway_bills WHERE organization_id = $1 AND status = 'generated'
      AND valid_until BETWEEN now() AND now() + interval '1 day' ORDER BY valid_until`, [c.organizationId])).rows;
  return { from, to, gspConfigured: gspConfigured(process.env),
    einvoiceDue: invoices.map((i) => ({ invoiceId: i.id, number: i.invoice_number, kind: i.invoice_type, date: ymd(i.invoice_date), value: rupees(paise(i.grand_total)), gstin: i.gstin || null, customer: i.customer, seller: i.registration_number })),
    ewayDue, expiring: expiring.map((e) => ({ sourceType: e.source_type, sourceId: e.source_id, number: e.source_number, ewbNumber: e.ewb_number, validUntil: e.valid_until })) };
}
