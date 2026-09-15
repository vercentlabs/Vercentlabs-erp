import assert from "node:assert/strict";
import test from "node:test";

import { verifyAttachmentContent, scanAttachmentForUpload, AttachmentSecurityError } from "../src/core/attachment-security.js";

const PNG_MAGIC = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const PDF_MAGIC = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0, 0]);

test("verifyAttachmentContent validates the magic bytes, not just the declared content-type", () => {
  assert.doesNotThrow(() => verifyAttachmentContent(PNG_MAGIC, "image/png"));
  const fakeAsPng = Uint8Array.from([1, 2, 3, 4]);
  assert.throws(
    () => verifyAttachmentContent(fakeAsPng, "image/png"),
    (error) => error instanceof AttachmentSecurityError && error.code === "ATTACHMENT_CONTENT_TYPE_MISMATCH",
  );
});

test("verifyAttachmentContent rejects the EICAR antivirus test string even inside an otherwise-valid text file", () => {
  const bytes = new TextEncoder().encode("EICAR-STANDARD-ANTIVIRUS-TEST-FILE marker present");
  assert.throws(
    () => verifyAttachmentContent(bytes, "text/plain"),
    (error) => error instanceof AttachmentSecurityError && error.code === "ATTACHMENT_MALWARE_DETECTED",
  );
});

test("verifyAttachmentContent rejects empty content", () => {
  assert.throws(
    () => verifyAttachmentContent(new Uint8Array(), "application/pdf"),
    (error) => error instanceof AttachmentSecurityError && error.code === "ATTACHMENT_CONTENT_EMPTY",
  );
});

test("scanAttachmentForUpload in 'required' mode fails closed (503) when no external scanner is configured", async () => {
  await assert.rejects(
    scanAttachmentForUpload(PDF_MAGIC, "application/pdf", { ATTACHMENT_SCAN_MODE: "required" }),
    (error) => error instanceof AttachmentSecurityError && error.code === "ATTACHMENT_SCAN_NOT_CONFIGURED",
  );
});

test("scanAttachmentForUpload in 'local' mode still runs the content-type/EICAR checks before accepting", async () => {
  await assert.rejects(
    scanAttachmentForUpload(new Uint8Array([1, 2, 3]), "application/pdf", { ATTACHMENT_SCAN_MODE: "local" }),
    AttachmentSecurityError,
  );
  const result = await scanAttachmentForUpload(PDF_MAGIC, "application/pdf", { ATTACHMENT_SCAN_MODE: "local" });
  assert.equal(result.scanStatus, "clean");
});
