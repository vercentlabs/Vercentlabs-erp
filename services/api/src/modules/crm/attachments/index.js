// CRM Attachments: the files on a lead, account, contact, opportunity or
// note, stored through the Shared Platform file service. Quotations, orders
// and invoices are structured documents of their own, never uploaded files.
export { CRM_ALLOWED_EXTENSIONS, CRM_ALLOWED_MIME_TYPES, CRM_FILE_TYPES, crmAttachmentMaxBytes, fileTypeOf } from "./file-types.js";
export {
  deleteAttachment, downloadAttachment, getAttachment, getAttachmentPreview, listAttachments, prepareAttachmentUpload, updateAttachment, uploadAttachment,
} from "./records.js";
