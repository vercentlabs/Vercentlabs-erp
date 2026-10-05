// The vocabulary of deliveries.
//
// A delivery is what the seller actually dispatches against a confirmed
// sales order: several per order, each from one warehouse. Draft and Ready
// move no stock; Dispatched is when the goods leave and stock is issued;
// Delivered is when the customer received them. A delivery is cancelled only
// before dispatch; after that, goods come back through a sales return.
import { OrderError } from "../orders/constants.js";

export const DELIVERY_STATUS = Object.freeze({ draft: "draft", ready: "ready", dispatched: "dispatched", delivered: "delivered", cancelled: "cancelled" });
export const DELIVERY_STATUS_LABELS = Object.freeze({ draft: "Draft", ready: "Ready to dispatch", dispatched: "Dispatched", delivered: "Delivered", cancelled: "Cancelled" });
// Where the goods are, as the shipment shows it.
export const SHIPMENT_LABELS = Object.freeze({ draft: "Not shipped", ready: "Not shipped", dispatched: "In transit", delivered: "Delivered", cancelled: "Not shipped" });
export const OPEN = Object.freeze([DELIVERY_STATUS.draft, DELIVERY_STATUS.ready]);
export const SHIPPED = Object.freeze([DELIVERY_STATUS.dispatched, DELIVERY_STATUS.delivered]);

export const DELIVERY_CANCEL_REASONS = Object.freeze([
  { code: "customer_request", label: "Customer request" },
  { code: "incorrect_delivery", label: "Incorrect delivery" },
  { code: "warehouse_change", label: "Warehouse change" },
  { code: "order_change", label: "Order change" },
  { code: "duplicate_delivery", label: "Duplicate delivery" },
  { code: "other", label: "Other" },
]);

export const DELIVERY_PERMISSIONS = Object.freeze({
  view: "sales.delivery.view",
  viewAll: "sales.delivery.view_all",
  create: "sales.fulfillment.request",
  edit: "sales.delivery.edit",
  dispatch: "sales.delivery.dispatch",
  deliver: "sales.delivery.deliver",
  cancel: "sales.delivery.cancel",
  print: "sales.delivery.print",
  changeWarehouse: "sales.order.change_warehouse",
  invoice: "sales.invoice.request",
});

export const DELIVERY_VIEWS = Object.freeze([
  { key: "all", label: "All Deliveries" },
  { key: "draft", label: "Draft" },
  { key: "ready", label: "Ready to Dispatch" },
  { key: "in_transit", label: "Dispatched / In Transit" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
  { key: "mine", label: "My Deliveries" },
  { key: "due_today", label: "Due Today" },
  { key: "overdue", label: "Overdue Delivery" },
]);

export class DeliveryError extends OrderError {
  constructor(status, message, code = "SALES_DELIVERY_ERROR", details = undefined) {
    super(status, message, code, details);
    this.name = "DeliveryError";
  }
}
