// Stock Reservation: committing usable stock to confirmed sales demand, and
// giving it back. Inventory owns the reservation records; Sales decides when
// and how much.
export {
  RELEASE_REASONS as SALES_RESERVATION_RELEASE_REASONS, RESERVATION_PERMISSIONS as SALES_RESERVATION_PERMISSIONS, RESERVATION_STATUS_LABELS as SALES_RESERVATION_STATUS_LABELS,
} from "./constants.js";
export {
  getSalesOrderReservations, reconcileSalesReservations, releaseSalesOrderReservation, reserveSalesOrderLine, reserveSalesOrderStock,
} from "./service.js";
