// The vocabulary of stock reservations for sales orders.
//
// A reservation commits usable stock in one warehouse to one confirmed order
// line. It is a commitment, not a movement: on hand, inventory value and the
// books are untouched until a delivery issues the goods. Whether an order is
// reserved is shown beside its status, never as its status.
import { reservationStatusOfCounts } from "../order-tracking/derive.js";

export const RESERVATION_PERMISSIONS = Object.freeze({
  view: "sales.reservation.view",
  viewAll: "sales.reservation.view_all",
  reserve: "sales.order.reserve",
  release: "sales.reservation.release",
});

export const RESERVATION_REFERENCE = "sales_order_line";

// Why a reservation was given back by hand.
export const RELEASE_REASONS = Object.freeze([
  { code: "customer_delay", label: "Customer delay" },
  { code: "warehouse_reassignment", label: "Warehouse reassignment" },
  { code: "order_amendment", label: "Order amendment" },
  { code: "reservation_correction", label: "Reservation correction" },
  { code: "other", label: "Other" },
]);
// Releases made by the system, with the event that caused them.
export const SYSTEM_RELEASE_REASONS = Object.freeze({
  order_cancelled: "Order cancelled",
  quantity_cancelled: "Remaining quantity cancelled",
  order_reopened: "Order reopened to draft",
  warehouse_changed: "Fulfillment warehouse changed",
});

export const RESERVATION_STATUS_LABELS = Object.freeze({
  not_required: "Not required", not_reserved: "Not reserved", partially_reserved: "Partially reserved", fully_reserved: "Fully reserved",
});
export const RECORD_STATUS_LABELS = Object.freeze({ active: "Active", consumed: "Consumed", released: "Released", cancelled: "Cancelled" });

// A reservation held this many days or more is flagged, never released by itself.
export const STALE_AFTER_DAYS = 30;

// An order's reservation state, from its lines still to deliver: services and non-stock products need none. The rule itself
// is the tracking service's (../order-tracking/derive.js), so every screen reads the same status.
export function reservationStatusOf(lines) {
  const open = lines.filter((line) => line.stockTracked && line.remainingToDeliver > 1e-6);
  return reservationStatusOfCounts({
    openLines: open.length, fullLines: open.filter((line) => line.reserved + 1e-6 >= line.remainingToDeliver).length, reservedLines: open.filter((line) => line.reserved > 1e-6).length,
  });
}
