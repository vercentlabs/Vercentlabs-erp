// The vocabulary of order confirmations.
//
// An order confirmation is the seller's confirmation of a sales order: the
// order's own number, titled "Order Confirmation", with a revision number
// when it was reopened and confirmed again. It is not a second order and not
// a second customer acceptance. Whether it was sent is its own state, apart
// from the order's status, its fulfillment and its invoicing.
export const CONFIRMATION_PERMISSIONS = Object.freeze({
  view: "sales.order.view",
  print: "sales.order.export",
  confirm: "sales.order.confirm",
  reopen: "sales.order.reopen",
  send: "sales.order.confirmation.send",
  markSent: "sales.order.confirmation.mark_sent",
  acknowledge: "sales.order.confirmation.acknowledge",
  quoteVariance: "sales.order.confirm_quote_variance",
});

// How a confirmation went out when it was not emailed from Vercentlabs.
export const SENT_CHANNELS = Object.freeze([
  { code: "external_email", label: "Email from another mailbox" },
  { code: "whatsapp", label: "WhatsApp" },
  { code: "printed", label: "Printed copy" },
  { code: "other", label: "Other" },
]);
export const CHANNEL_LABELS = Object.freeze({ email: "Email from Vercentlabs", ...Object.fromEntries(SENT_CHANNELS.map((channel) => [channel.code, channel.label])) });

export const CONFIRMATION_STATUS_LABELS = Object.freeze({
  none: "Not confirmed", not_sent: "Not sent", sent: "Sent", acknowledged: "Acknowledged", superseded: "Superseded",
});

// The communication state of a confirmation row (or of an order's current one).
export function confirmationStatus(row) {
  if (!row?.id) return "none";
  if (row.superseded_at) return "superseded";
  if (row.acknowledged_at) return "acknowledged";
  if (row.sent_at) return "sent";
  return "not_sent";
}
