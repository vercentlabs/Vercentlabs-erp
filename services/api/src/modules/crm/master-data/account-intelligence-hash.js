// Stable (key-sorted) SHA-256 used for privacy execution evidence, retention
// runs and acceptance evidence. Deliberately local to this area: other CRM
// hash helpers are not interchangeable with it.

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

export function crmAccountIntelligenceHash(value) {
  return createHash("sha256").update(stable(value)).digest("hex");
}
