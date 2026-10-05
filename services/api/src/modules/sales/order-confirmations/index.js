// Order Confirmation: confirming a sales order, the immutable record of what
// was confirmed (one revision per confirmation), sending it to the customer
// and recording the customer's acknowledgement. It lives on the sales order;
// it is not a second order.
export {
  CONFIRMATION_PERMISSIONS as ORDER_CONFIRMATION_PERMISSIONS, CONFIRMATION_STATUS_LABELS as ORDER_CONFIRMATION_STATUS_LABELS, SENT_CHANNELS as ORDER_CONFIRMATION_SENT_CHANNELS,
} from "./constants.js";
export { validateSalesOrderForConfirmation } from "./validation.js";
export { confirmSalesOrder } from "./confirm.js";
export { CONFIRMATION_FILE_ENTITY as ORDER_CONFIRMATION_FILE_ENTITY, getOrderConfirmation, markOrderConfirmationSent, recordCustomerAcknowledgement, sendOrderConfirmation } from "./communication.js";
