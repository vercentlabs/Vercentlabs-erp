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
});

// { column: value } for every shipment field in `input` (missing ones are null).
export function shipmentColumns(input) {
  return Object.fromEntries(Object.entries(SHIPMENT_FIELDS).map(([key, [column, read]]) => [column, read(input[key])]));
}
