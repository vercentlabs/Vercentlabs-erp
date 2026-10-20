// Support — the ticket desk: errors and messages, permissions, the lifecycle and its vocabularies, and small input helpers.
//
//   new → open ⇄ pending_customer / pending_internal → resolved → closed          (cancelled from new, before any work)
//
//   new                created (by hand or from an email), awaiting triage / an agent.
//   open               an agent is actively responsible.
//   pending_customer   waiting for the customer's information (the response clock pauses); their reply returns it to open.
//   pending_internal   waiting for another internal team.
//   resolved           a solution was given, with a resolution summary.
//   closed             formally finished; the conversation stays.
// Reopening is an event, not a status: an authorized agent (or the customer's reply, when the mailbox's policy allows it for a resolved
// ticket) returns it to open and the reopen is recorded. A customer reply to a closed ticket opens a follow-up ticket linked to it.
export const P = Object.freeze({
  view: "support.view", viewAll: "support.ticket.view_all", create: "support.ticket.create", assign: "support.ticket.assign", resolve: "support.ticket.resolve",
  close: "support.ticket.close", reopen: "support.ticket.reopen", reply: "support.ticket.reply", note: "support.ticket.note", communicate: "support.communication.manage",
  mailbox: "support.mailbox.manage", settings: "support.settings.manage", reports: "support.reports.view", sensitive: "support.sensitive.view", manage: "support.manage",
});
export const STATUS = Object.freeze({ new: "New", open: "Open", pending_customer: "Pending customer", pending_internal: "Pending internal", resolved: "Resolved", closed: "Closed",
  cancelled: "Cancelled", merged: "Merged" });
export const ACTIVE = Object.freeze(["new", "open", "pending_customer", "pending_internal"]);
export const PRIORITY = Object.freeze({ low: "Low", normal: "Normal", high: "High", urgent: "Urgent" });
export const KIND = Object.freeze({ CUSTOMER: "Customer message", REPLY: "Reply to customer", NOTE: "Private note", SYSTEM: "System" });
export const DELIVERY = Object.freeze({ RECEIVED: "Received", QUEUED: "Sending", SENT: "Sent to the mail server", FAILED: "Failed", BOUNCED: "Bounced", NOT_SENT: "Not sent" });

const MESSAGES = Object.freeze({
  SUPPORT_TICKET_NOT_FOUND: "That ticket was not found.",
  SUPPORT_ACCESS_DENIED: "You do not have permission for this action.",
  SUPPORT_TICKET_INVALID: "Review the ticket details.",
  SUPPORT_TICKET_STATE: "The ticket cannot do that in its current state.",
  SUPPORT_CONCURRENT_CHANGE: "This ticket changed. Refresh before continuing.",
  SUPPORT_AGENT_INVALID: "Choose an active support agent.",
  SUPPORT_CONTACT_INVALID: "That contact does not belong to the customer.",
  SUPPORT_RESOLUTION_REQUIRED: "Record the resolution.",
  SUPPORT_REASON_REQUIRED: "Give a reason.",
  SUPPORT_MAILBOX_REQUIRED: "Choose an active support mailbox to reply from.",
  SUPPORT_RECIPIENT_REQUIRED: "The ticket has no customer email address to reply to.",
  SUPPORT_MESSAGE_INVALID: "Write the message.",
  SUPPORT_MAILBOX_INVALID: "Review the support mailbox.",
});
export class SupportDeskError extends Error {
  constructor(status, code, message, details) {
    super(message || MESSAGES[code] || "The support request could not be completed.");
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
export const sdError = (status, code, message, details) => new SupportDeskError(status, code, message, details);
export const has = (c, p) => Boolean(c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(p));
export const need = (c, ...list) => {
  if (!list.some((p) => has(c, p))) throw sdError(403, "SUPPORT_ACCESS_DENIED");
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const uuid = (value, label = "Reference") => {
  if (!UUID.test(String(value ?? ""))) throw sdError(400, "SUPPORT_TICKET_INVALID", `${label} is invalid.`);
  return String(value);
};
export const uuidOrNull = (value, label) => (value === undefined || value === null || value === "" ? null : uuid(value, label));
export const text = (value, max = 500) => String(value ?? "").trim().slice(0, max);
export const textOrNull = (value, max = 500) => text(value, max) || null;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const email = (value) => {
  const v = text(value, 320).toLowerCase();
  return EMAIL.test(v) ? v : null;
};
export const oneOf = (value, map, label) => {
  const v = String(value ?? "").toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(map, v)) throw sdError(400, "SUPPORT_TICKET_INVALID", `${label}: choose one of ${Object.values(map).join(", ")}.`);
  return v;
};
export const expectVersion = (row, input) => {
  if (input?.version !== undefined && input.version !== null && input.version !== "" && Number(input.version) !== Number(row.row_version)) throw sdError(409, "SUPPORT_CONCURRENT_CHANGE");
};
// What a person may see: everything with view_all; otherwise their own tickets and the unassigned ones.
export const visibleSql = (c, alias = "t", param = "$2") => (has(c, P.viewAll) || has(c, P.manage) ? `(${param}::uuid IS NULL OR TRUE)` : `(${alias}.assigned_user_id = ${param}::uuid OR ${alias}.assigned_user_id IS NULL)`);
