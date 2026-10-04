// Attachment validation helpers. No DB dependency.
import { createHash } from "node:crypto";
import { isProductionRuntime } from "@vercentlabs/config";

export class AttachmentSecurityError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "AttachmentSecurityError";
    this.status = status;
    this.code = code;
  }
}

function startsWith(bytes, signature) {
  return signature.every((value, index) => bytes[index] === value);
}

const OOXML_PART = Object.freeze({
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word/",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xl/",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "ppt/",
});
const OLE_TYPES = new Set(["application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint"]);

// ZIP entry names are stored as plain text, so the part a format needs can be found in the archive's bytes.
function containsAscii(bytes, value) {
  return Buffer.from(bytes).includes(Buffer.from(value, "ascii"));
}

export function verifyAttachmentContent(bytes, mimeType) {
  if (!bytes.length) throw new AttachmentSecurityError(400, "Attachment content is empty.", "ATTACHMENT_CONTENT_EMPTY");
  const normalized = String(mimeType || "").toLowerCase();
  const valid =
    (normalized === "application/pdf" && startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) ||
    (normalized === "image/png" && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (normalized === "image/jpeg" && startsWith(bytes, [0xff, 0xd8, 0xff])) ||
    ((normalized === "text/plain" || normalized === "text/csv") && !bytes.includes(0)) ||
    // Office files: the 2007+ formats are ZIP containers holding their own XML part; the older ones are OLE compound files.
    (OOXML_PART[normalized] && startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) && containsAscii(bytes, OOXML_PART[normalized])) ||
    (OLE_TYPES.has(normalized) && startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if (!valid) {
    throw new AttachmentSecurityError(400, "Attachment content does not match its declared file type.", "ATTACHMENT_CONTENT_TYPE_MISMATCH");
  }
  const textProbe = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 16_384))).toString("latin1");
  if (textProbe.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) {
    throw new AttachmentSecurityError(422, "Attachment was rejected by malware scanning.", "ATTACHMENT_MALWARE_DETECTED");
  }
}

export async function scanAttachmentForUpload(bytes, mimeType, env = process.env) {
  verifyAttachmentContent(bytes, mimeType);
  const mode = String(env.ATTACHMENT_SCAN_MODE || (isProductionRuntime(env) ? "required" : "local")).toLowerCase();
  if (mode === "local") return { scanStatus: "clean", scanner: "local-content-policy" };
  if (mode !== "required") throw new AttachmentSecurityError(503, "Attachment scan mode is invalid.", "ATTACHMENT_SCAN_CONFIGURATION_INVALID");

  const endpoint = String(env.ATTACHMENT_SCAN_URL || "").trim();
  const token = String(env.ATTACHMENT_SCAN_TOKEN || "").trim();
  if (!endpoint || !token) {
    throw new AttachmentSecurityError(503, "Attachment malware scanning is required but not configured.", "ATTACHMENT_SCAN_NOT_CONFIGURED");
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new AttachmentSecurityError(503, "Attachment scan URL is invalid.");
  }
  if (isProductionRuntime(env) && url.protocol !== "https:") {
    throw new AttachmentSecurityError(503, "Attachment scan URL must use HTTPS in production.");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": mimeType, "X-Content-SHA256": digest },
    body: Buffer.from(bytes),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new AttachmentSecurityError(502, "Attachment malware scanner is unavailable.", "ATTACHMENT_SCAN_FAILED");
  if (payload.clean !== true) throw new AttachmentSecurityError(422, "Attachment was rejected by malware scanning.", "ATTACHMENT_MALWARE_DETECTED");
  return { scanStatus: "clean", scanner: "external" };
}
