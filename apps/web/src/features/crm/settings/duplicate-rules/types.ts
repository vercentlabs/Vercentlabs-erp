export const DUPLICATE_ENTITY_TYPES = ["lead", "contact", "account"] as const;
export type DuplicateEntityType = (typeof DUPLICATE_ENTITY_TYPES)[number];

export type DuplicateSignalMethod = "exact" | "normalized" | "fuzzy";

// Mirrors services/api/.../duplicate-rules.js's DUPLICATE_SIGNAL_CATALOG
// exactly — the fixed, code-reviewed set of comparisons an org may
// enable/reweight. This screen only ever lets an admin pick FROM this
// list, never type a signal/method freely, matching the backend's own
// anti-injection design (a rule is structured data, never free SQL).
export const DUPLICATE_SIGNAL_CATALOG: Record<DuplicateEntityType, Array<{ signal: string; method: DuplicateSignalMethod; label: string }>> = {
  lead: [
    { signal: "email", method: "exact", label: "Email (exact match)" },
    { signal: "mobile", method: "normalized", label: "Mobile number (normalized, last 15 digits)" },
    { signal: "name_and_company", method: "normalized", label: "Name + company name (normalized)" },
  ],
  contact: [
    { signal: "email", method: "exact", label: "Email (exact match)" },
    { signal: "mobile", method: "normalized", label: "Mobile/phone (normalized, last 15 digits)" },
    { signal: "name", method: "normalized", label: "Full name (normalized)" },
    { signal: "name", method: "fuzzy", label: "Full name (fuzzy similarity)" },
  ],
  account: [
    { signal: "gstin", method: "exact", label: "GSTIN (exact match)" },
    { signal: "pan", method: "exact", label: "PAN (exact match)" },
    { signal: "legal_name", method: "normalized", label: "Legal/company name (normalized)" },
    { signal: "legal_name", method: "fuzzy", label: "Legal/company name (fuzzy similarity)" },
  ],
};

export type DuplicateRule = {
  id: string;
  entityType: DuplicateEntityType;
  signal: string;
  method: DuplicateSignalMethod;
  weight: number;
  fuzzyThreshold: number | null;
  enabled: boolean;
  blocking: boolean;
  updatedAt: string;
};
