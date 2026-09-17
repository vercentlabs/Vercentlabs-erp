import { createHash } from "node:crypto";

import { HttpError } from "@/core/http";

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

export function verifyAttachmentContent(bytes: Uint8Array, mimeType: string) {
  if (!bytes.length) throw new HttpError(400, "Attachment content is empty.", "ATTACHMENT_CONTENT_EMPTY");
  const normalized = String(mimeType || "").toLowerCase();
  const valid =
    (normalized === "application/pdf" && startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) ||
    (normalized === "image/png" && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (normalized === "image/jpeg" && startsWith(bytes, [0xff, 0xd8, 0xff])) ||
    ((normalized === "text/plain" || normalized === "text/csv") && !bytes.includes(0));
  if (!valid) {
    throw new HttpError(400, "Attachment content does not match its declared file type.", "ATTACHMENT_CONTENT_TYPE_MISMATCH");
  }
  const textProbe = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 16_384))).toString("latin1");
  if (textProbe.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) {
    throw new HttpError(422, "Attachment was rejected by malware scanning.", "ATTACHMENT_MALWARE_DETECTED");
  }
}

export async function scanAttachmentForUpload(bytes: Uint8Array, mimeType: string) {
  verifyAttachmentContent(bytes, mimeType);
  const mode = String(process.env.ATTACHMENT_SCAN_MODE || (process.env.NODE_ENV === "production" ? "required" : "local")).toLowerCase();
  if (mode === "local") return { scanStatus: "clean" as const, scanner: "local-content-policy" };
  if (mode !== "required") throw new HttpError(503, "Attachment scan mode is invalid.", "ATTACHMENT_SCAN_CONFIGURATION_INVALID");

  const endpoint = String(process.env.ATTACHMENT_SCAN_URL || "").trim();
  const token = String(process.env.ATTACHMENT_SCAN_TOKEN || "").trim();
  if (!endpoint || !token) {
    throw new HttpError(503, "Attachment malware scanning is required but not configured.", "ATTACHMENT_SCAN_NOT_CONFIGURED");
  }
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new HttpError(503, "Attachment scan URL is invalid."); }
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new HttpError(503, "Attachment scan URL must use HTTPS in production.");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": mimeType,
      "X-Content-SHA256": digest,
    },
    body: Buffer.from(bytes),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => ({}))) as { clean?: unknown; reason?: unknown };
  if (!response.ok) throw new HttpError(502, "Attachment malware scanner is unavailable.", "ATTACHMENT_SCAN_FAILED");
  if (payload.clean !== true) throw new HttpError(422, "Attachment was rejected by malware scanning.", "ATTACHMENT_MALWARE_DETECTED");
  return { scanStatus: "clean" as const, scanner: "external" };
}
