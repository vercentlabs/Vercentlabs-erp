// Stable (key-sorted) SHA-256 content hash used for OAuth state/verifier
// hashes, provider payload hashes, email event ids and acceptance evidence.

import { createHash } from "node:crypto";


function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function crmCommunicationsHash(value) {
  return createHash("sha256").update(stable(value)).digest("hex");
}
