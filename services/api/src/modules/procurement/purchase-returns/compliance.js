// Moving returned goods (Procurement plan Phase 2): goods going back to a supplier travel under a delivery challan (CGST rule 55) and, when
// the consignment is worth ₹50,000 or more, an e-way bill. The return keeps its transport (vehicle, transporter, distance) and the e-way
// bill's number and validity; the e-way bill itself is generated on the portal from the JSON downloaded here (the NIC bulk-upload format),
// or through the GSP from the GST module when one is set up.
import { EWAY_BILL_THRESHOLD, buildEwayBillPayload, movementOf } from "../../../orchestration/compliance/index.js";
import { poCan } from "../purchase-orders/access.js";
import { PurchaseReturnError, RETURN_PERMISSIONS, fail, text } from "./constants.js";
import { loadReturn } from "./returns.js";

const EWB = /^\d{12}$/;
const GSTIN_OR_TRANSPORTER = /^[0-9]{2}[A-Z0-9]{13}$/;

async function movement(client, context, row) {
  try {
    return await movementOf(client, context.organizationId, "purchase_return", row.id);
  } catch (error) {
    throw new PurchaseReturnError(error.status ?? 409, error.message, error.code ?? "PURCHASE_RETURN_EWAY_UNAVAILABLE");
  }
}

// The return's transport and e-way bill: what the consignment is worth, whether an e-way bill is needed, what is still missing for one,
// and the e-way bill recorded (on the return, or generated through the GST module).
export async function getPurchaseReturnTransport(client, context, returnId) {
  const row = await loadReturn(client, context, returnId);
  const moving = await movement(client, context, row);
  const payload = buildEwayBillPayload(moving, { vehicleNumber: row.vehicle_number, transporterId: row.transporter_id, distanceKm: row.transport_distance_km ?? 0 });
  const generated = (await client.query(`SELECT ewb_number, valid_until FROM tenant.eway_bills WHERE organization_id = $1 AND source_type = 'purchase_return' AND source_id = $2 AND status = 'generated'
      ORDER BY created_at DESC LIMIT 1`, [context.organizationId, row.id])).rows[0];
  const missing = [];
  if (!moving.seller?.registration_number) missing.push("The company's GSTIN for the sending warehouse");
  if (!payload.toPincode) missing.push("The supplier's PIN code on the return-to address");
  if (!payload.itemList.every((item) => item.hsnCode)) missing.push("An HSN code on every returned item");
  if (!payload.vehicleNo && !payload.transporterId) missing.push("The vehicle number or the transporter's ID");
  return {
    value: payload.totInvValue, taxable: payload.totalValue, required: payload.totInvValue >= EWAY_BILL_THRESHOLD, threshold: EWAY_BILL_THRESHOLD, missing,
    vehicleNumber: row.vehicle_number, transporterId: row.transporter_id, transporterName: row.transporter_name, distanceKm: row.transport_distance_km,
    ewbNumber: row.ewb_number ?? generated?.ewb_number ?? null, ewbValidUntil: row.ewb_valid_until ?? generated?.valid_until ?? null,
    canEdit: row.document_status !== "cancelled" && (poCan(context, RETURN_PERMISSIONS.manage) || poCan(context, RETURN_PERMISSIONS.post)),
  };
}

// updatePurchaseReturnTransport. input: { vehicleNumber?, transporterId?, transporterName?, distanceKm?, ewbNumber?, ewbValidUntil? }
export async function updatePurchaseReturnTransport(client, context, returnId, input = {}) {
  if (!poCan(context, RETURN_PERMISSIONS.manage) && !poCan(context, RETURN_PERMISSIONS.post))
    throw new PurchaseReturnError(403, "You do not have permission to change the return's transport.", "PERMISSION_DENIED");
  const row = await loadReturn(client, context, returnId, { lock: true });
  if (row.document_status === "cancelled") throw new PurchaseReturnError(409, "A cancelled return does not move.", "PURCHASE_RETURN_LOCKED");
  const has = (key) => Object.prototype.hasOwnProperty.call(input, key);
  const vehicle = has("vehicleNumber") ? (text(input.vehicleNumber, 20)?.toUpperCase().replace(/[\s-]/g, "") ?? null) : row.vehicle_number;
  if (vehicle && !/^[A-Z0-9]{6,12}$/.test(vehicle)) fail("Enter the vehicle number, such as MH12AB1234.", "vehicleNumber", "PURCHASE_RETURN_TRANSPORT_INVALID");
  const transporterId = has("transporterId") ? (text(input.transporterId, 20)?.toUpperCase() ?? null) : row.transporter_id;
  if (transporterId && !GSTIN_OR_TRANSPORTER.test(transporterId)) fail("The transporter ID is their 15-character GSTIN or TRANSIN.", "transporterId", "PURCHASE_RETURN_TRANSPORT_INVALID");
  const distance = has("distanceKm") ? (input.distanceKm === null || input.distanceKm === "" ? null : Number(input.distanceKm)) : row.transport_distance_km;
  if (distance !== null && (!Number.isInteger(distance) || distance < 0 || distance > 4000)) fail("Enter the distance in kilometres (0 to 4,000).", "distanceKm", "PURCHASE_RETURN_TRANSPORT_INVALID");
  const ewb = has("ewbNumber") ? (text(input.ewbNumber, 20)?.replace(/\s/g, "") ?? null) : row.ewb_number;
  if (ewb && !EWB.test(ewb)) fail("The e-way bill number is 12 digits.", "ewbNumber", "PURCHASE_RETURN_TRANSPORT_INVALID");
  const until = has("ewbValidUntil") ? (input.ewbValidUntil ? new Date(String(input.ewbValidUntil)) : null) : row.ewb_valid_until;
  if (until && Number.isNaN(new Date(until).getTime())) fail("Enter the e-way bill's validity.", "ewbValidUntil", "PURCHASE_RETURN_TRANSPORT_INVALID");
  if (ewb && !until) fail("Enter until when the e-way bill is valid.", "ewbValidUntil", "PURCHASE_RETURN_TRANSPORT_INVALID");
  await client.query(
    `UPDATE tenant.purchase_returns SET vehicle_number = $3, transporter_id = $4, transporter_name = $5, transport_distance_km = $6, ewb_number = $7, ewb_valid_until = $8,
            updated_by = $9, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, vehicle, transporterId, has("transporterName") ? text(input.transporterName, 200) : row.transporter_name, distance, ewb, until, context.userId ?? null]);
  return getPurchaseReturnTransport(client, context, row.id);
}

// The e-way bill JSON for the portal's bulk upload (version 1.0.0621): one bill for this return, from its lines and transport.
export async function purchaseReturnEwayBillJson(client, context, returnId) {
  const row = await loadReturn(client, context, returnId);
  const moving = await movement(client, context, row);
  if (!moving.seller?.registration_number) fail("The sending warehouse or company has no GSTIN.", "buyingRegistrationId", "EWAY_NO_GSTIN", 409);
  const bill = buildEwayBillPayload(moving, { vehicleNumber: row.vehicle_number, transporterId: row.transporter_id, distanceKm: row.transport_distance_km ?? 0 });
  return { fileName: `EWB-${row.return_number}.json`, json: { version: "1.0.0621", billLists: [{ userGstin: bill.fromGstin, ...bill, mainHsnCode: bill.itemList[0]?.hsnCode ?? "" }] } };
}

// The delivery challan (CGST rule 55) the goods travel under: consignor and consignee with their GSTINs, the place of supply, each item with
// its HSN, quantity, taxable value and tax, the transport, and the e-way bill when there is one. Data for the document registry.
export async function getPurchaseReturnChallan(client, context, returnId) {
  const row = await loadReturn(client, context, returnId);
  const moving = await movement(client, context, row);
  const bill = buildEwayBillPayload(moving, { vehicleNumber: row.vehicle_number, transporterId: row.transporter_id, distanceKm: row.transport_distance_km ?? 0 });
  return { purchaseReturn: { id: row.id, number: row.return_number, date: row.dispatched_at ?? row.return_date, status: row.document_status, reason: row.reason,
      vehicleNumber: row.vehicle_number, transporterName: row.transporter_name, transporterId: row.transporter_id, ewbNumber: row.ewb_number, ewbValidUntil: row.ewb_valid_until },
    movement: moving, bill };
}
