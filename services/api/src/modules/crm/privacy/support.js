// Shared helpers of the privacy (data-subject request and retention)
// operations: the identifier check and the stable evidence hash.
import { createHash } from "node:crypto";

import { CrmError } from "../data-management/errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertId(value, label) {
  const id = String(value ?? "").trim();
  if (!UUID.test(id)) throw new CrmError(400, `${label} is invalid.`, "CRM_IDENTIFIER_INVALID");
  return id;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

// Stable (key-sorted) SHA-256 used as execution evidence of privacy requests and retention runs.
export function privacyEvidenceHash(value) {
  return createHash("sha256").update(stable(value)).digest("hex");
}
