// Reading a delivery's shipment details: carrier, tracking, vehicle, expected date and packages.
import { text } from "../orders/constants.js";
import { readDate } from "../orders/versions.js";
import { DeliveryError } from "./constants.js";

export function readTrackingUrl(value) {
  const url = text(value, 500);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("protocol");
    return parsed.toString();
  } catch {
    throw new DeliveryError(400, "The tracking link must be a web address (https://…).", "SALES_DELIVERY_VALIDATION", { field: "trackingUrl" });
  }
}

// Transport for the e-way bill's Part B (Line-by-line audit S22).
export function readTransporterId(value) {
  const id = text(value, 20)?.toUpperCase().replace(/\s/g, "") || null;
  if (id && !/^[0-9A-Z]{15}$/.test(id)) throw new DeliveryError(400, "The transporter ID is the transporter's 15-character GSTIN or TRANSIN.", "SALES_DELIVERY_VALIDATION", { field: "transporterId" });
  return id;
}
export function readTransportMode(value) {
  const mode = text(value, 10);
  if (mode && !["road", "rail", "air", "ship"].includes(mode)) throw new DeliveryError(400, "Choose road, rail, air or ship.", "SALES_DELIVERY_VALIDATION", { field: "transportMode" });
  return mode || null;
}
export function readDistance(value) {
  if (value == null || value === "") return null;
  const distance = Number(value);
  if (!Number.isInteger(distance) || distance < 0 || distance > 4000) throw new DeliveryError(400, "Enter the distance in kilometres (0 to 4,000).", "SALES_DELIVERY_VALIDATION", { field: "distanceKm" });
  return distance;
}

export function readPackageCount(value) {
  if (value == null || value === "") return null;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0 || count > 100000) throw new DeliveryError(400, "Enter the number of packages.", "SALES_DELIVERY_VALIDATION", { field: "packageCount" });
  return count;
}

// input key → [column, reader]
export const SHIPMENT_FIELDS = Object.freeze({
  carrier: ["carrier", (value) => text(value, 120)],
  trackingNumber: ["tracking_number", (value) => text(value, 120)],
  trackingUrl: ["tracking_url", readTrackingUrl],
  vehicleReference: ["vehicle_reference", (value) => text(value, 120)],
  expectedDeliveryDate: ["expected_delivery_date", (value) => readDate(value, "Expected delivery date")],
  packageCount: ["package_count", readPackageCount],
  packageNotes: ["package_notes", (value) => text(value, 1000)],
  transporterId: ["transporter_id", readTransporterId],
  transportMode: ["transport_mode", readTransportMode],
  distanceKm: ["distance_km", readDistance],
  transportDocumentNumber: ["transport_document_number", (value) => text(value, 30)],
  transportDocumentDate: ["transport_document_date", (value) => readDate(value, "Transport document date")],
});

// { column: value } for every shipment field in `input` (missing ones are null).
export function shipmentColumns(input) {
  return Object.fromEntries(Object.entries(SHIPMENT_FIELDS).map(([key, [column, read]]) => [column, read(input[key])]));
}
