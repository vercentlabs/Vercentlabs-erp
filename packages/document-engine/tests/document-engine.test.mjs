import assert from "node:assert/strict";
import test from "node:test";
import { attachmentStorageKey, sanitizeFileName, sha256, validateAttachment } from "../src/index.js";

test("attachment metadata and tenant storage keys are governed", () => {
  const organizationId = "018f1ec7-49c3-4a52-8c4e-52e164537b21";
  const attachmentId = "018f1ec7-49c3-4a52-8c4e-52e164537b22";
  assert.match(attachmentStorageKey({ organizationId, attachmentId, fileName: "../quote.pdf" }), new RegExp(organizationId));
  assert.equal(sanitizeFileName("../quote.pdf"), "..-quote.pdf");
  assert.equal(sha256("vercent").length, 64);
  assert.throws(() => validateAttachment({ fileName: "a.exe", mimeType: "application/x-msdownload", sizeBytes: 10 }), TypeError);
});
