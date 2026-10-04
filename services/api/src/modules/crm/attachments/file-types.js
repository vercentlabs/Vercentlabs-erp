// The files a CRM record may carry. The type is decided here, from the file
// name's extension, never taken from the browser; the Shared Platform upload
// pipeline then checks that the bytes really are that kind of file (magic
// bytes), scans them and refuses anything else. Executables, scripts,
// archives and macro-enabled Office files are not on the list, so they are
// refused outright.

export const CRM_FILE_TYPES = Object.freeze({
  pdf: { mimeType: "application/pdf", kind: "document", preview: "pdf" },
  doc: { mimeType: "application/msword", kind: "document" },
  docx: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "document" },
  xls: { mimeType: "application/vnd.ms-excel", kind: "spreadsheet" },
  xlsx: { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "spreadsheet" },
  csv: { mimeType: "text/csv", kind: "spreadsheet", preview: "text" },
  ppt: { mimeType: "application/vnd.ms-powerpoint", kind: "presentation" },
  pptx: { mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "presentation" },
  jpg: { mimeType: "image/jpeg", kind: "image", preview: "image" },
  jpeg: { mimeType: "image/jpeg", kind: "image", preview: "image" },
  png: { mimeType: "image/png", kind: "image", preview: "image" },
  txt: { mimeType: "text/plain", kind: "document", preview: "text" },
});

export const CRM_ALLOWED_MIME_TYPES = Object.freeze([...new Set(Object.values(CRM_FILE_TYPES).map((entry) => entry.mimeType))]);
export const CRM_ALLOWED_EXTENSIONS = Object.freeze(Object.keys(CRM_FILE_TYPES));

const DEFAULT_MAX_MB = 25;
// The per-file limit: 25 MB unless CRM_ATTACHMENT_MAX_MB says otherwise (never unlimited).
export function crmAttachmentMaxBytes(env = process.env) {
  const configured = Number(env.CRM_ATTACHMENT_MAX_MB);
  const megabytes = Number.isFinite(configured) && configured > 0 && configured <= 200 ? configured : DEFAULT_MAX_MB;
  return Math.round(megabytes * 1024 * 1024);
}

export function fileTypeOf(fileName) {
  const match = /\.([a-z0-9]{1,10})$/i.exec(String(fileName ?? "").trim());
  const extension = match ? match[1].toLowerCase() : "";
  const type = CRM_FILE_TYPES[extension];
  return type ? { extension, ...type } : null;
}

// What a mime type is, for the list and its filters.
export function kindOfMime(mimeType) {
  return Object.values(CRM_FILE_TYPES).find((entry) => entry.mimeType === mimeType)?.kind ?? "other";
}

// Shown inline only for types a browser renders safely; everything else downloads.
export function previewOfMime(mimeType) {
  return Object.values(CRM_FILE_TYPES).find((entry) => entry.mimeType === mimeType)?.preview ?? null;
}
