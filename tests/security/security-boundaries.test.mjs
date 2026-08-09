import assert from "node:assert/strict";
import test from "node:test";

import {
  attachmentStorageKey,
  sanitizeFileName,
  validateAttachment,
} from "../../packages/document-engine/src/index.js";
import { redact } from "../../packages/observability/src/index.js";
import { csvCell } from "../../packages/reporting-engine/src/index.js";

test("exports, logs and attachment paths reject common data-boundary attacks", () => {
  assert.match(csvCell('=HYPERLINK("https://invalid")'), /'=/);
  assert.deepEqual(redact({ password: "secret", safe: "visible" }), {
    password: "[REDACTED]",
    safe: "visible",
  });
  assert.equal(sanitizeFileName("../../payroll.csv"), "..-..-payroll.csv");
  assert.throws(
    () =>
      validateAttachment({
        fileName: "payload.svg",
        mimeType: "image/svg+xml",
        sizeBytes: 128,
      }),
    TypeError,
  );
  const key = attachmentStorageKey({
    organizationId: "018f1ec7-49c3-4a52-8c4e-52e164537b21",
    attachmentId: "018f1ec7-49c3-4a52-8c4e-52e164537b22",
    fileName: "../../quote.pdf",
  });
  assert.equal(key.includes(".."), false);
});
