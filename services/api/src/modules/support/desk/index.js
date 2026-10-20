// Support — the ticket desk (MVP 37): tickets and their lifecycle, customer messages, replies by email through support mailboxes, private
// notes, attachments, email-to-ticket, deadlines, queues, reports and settings.
export { P as SUPPORT_PERMISSIONS, SupportDeskError } from "./sd-rules.js";
export {
  assignTicket as assignSupportTicket, cancelTicket as cancelSupportTicket, closeTicket as closeSupportTicket, createTicket as createSupportTicket, linkTicketCustomer as linkSupportTicketCustomer,
  reopenTicket as reopenSupportTicket, resolveTicket as resolveSupportTicket, setTicketStatus as setSupportTicketStatus, updateTicket as updateSupportTicket,
} from "./sd-tickets.js";
export {
  addPrivateNote as addSupportNote, addTicketAttachment as addSupportAttachment, logCustomerMessage as logSupportCustomerMessage, prepareTicketAttachmentUpload as prepareSupportAttachmentUpload,
  readTicketAttachment as readSupportAttachment, removeTicketAttachment as removeSupportAttachment, replyToCustomer as replyToSupportCustomer, retryReply as retrySupportReply,
} from "./sd-messages.js";
export { deliverEmailToSupport, listSupportCategories, listSupportMailboxes, saveSupportCategory, saveSupportMailbox, supportMailAuthority } from "./sd-mail.js";
export {
  SUPPORT_REPORTS, exportSupportReport, getSupportCounts, getSupportDashboard, getSupportDeskSettings, getSupportReport, getSupportTicket, listCustomerContactsForSupport, listSupportOptions,
  listSupportTickets, saveSupportDeskSettings,
} from "./sd-read.js";
