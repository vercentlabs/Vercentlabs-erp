// The vocabulary of availability checks.
//
// Availability is worked out each time it is asked for, from Inventory; it
// is never stored as a figure on an order and is never a promise. Only a
// reservation commits stock. It is not part of an order's status either: an
// order stays Confirmed whatever its availability.
export const AVAILABILITY_PERMISSIONS = Object.freeze({
  view: "sales.availability.view",
  check: "sales.availability.check",
  otherWarehouses: "sales.availability.other_warehouses",
  changeWarehouse: "sales.order.change_warehouse",
});

export const RESULT_LABELS = Object.freeze({
  available: "Available",
  partially_available: "Partially available",
  unavailable: "Unavailable",
  not_required: "Nothing left to fulfil",
  not_tracked: "Not inventory tracked",
  no_warehouse: "Choose a warehouse",
});

export const SUMMARY_LABELS = Object.freeze({
  fully_available: "Fully available",
  partially_available: "Partially available",
  unavailable: "Unavailable",
  not_required: "Nothing to check",
});
