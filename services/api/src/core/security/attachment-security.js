// Ported verbatim (TS -> JS syntax only) from docs/frontend-rebuild/
// the recovered pre-rebuild snapshot (last present at commit d4df5eb1), apps/web/src/core/attachment-security.ts. No DB
// dependency; lowest-risk port in the platform set.
import { createHash } from "node:crypto";

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

export function verifyAttachmentContent(bytes, mimeType) {
  if (!bytes.length) throw new AttachmentSecurityError(400, "Attachment content is empty.", "ATTACHMENT_CONTENT_EMPTY");
  const normalized = String(mimeType || "").toLowerCase();
  const valid =
    (normalized === "application/pdf" && startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) ||
    (normalized === "image/png" && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (normalized === "image/jpeg" && startsWith(bytes, [0xff, 0xd8, 0xff])) ||
    ((normalized === "text/plain" || normalized === "text/csv") && !bytes.includes(0));
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
  const mode = String(env.ATTACHMENT_SCAN_MODE || (env.NODE_ENV === "production" ? "required" : "local")).toLowerCase();
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
  if (env.NODE_ENV === "production" && url.protocol !== "https:") {
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
