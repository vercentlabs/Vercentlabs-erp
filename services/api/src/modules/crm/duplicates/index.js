// Duplicate detection for CRM: markNotDuplicate, listDuplicateQueue, recordDuplicateOverride, the review lists and the import columns.
//
// The matchers live with their records (leads/, contacts/, accounts/) and
// share the normalization, grading and policy here, so "the same email" means
// the same thing wherever it is asked. Every check is scoped to the caller's
// organization; nothing is ever compared across organizations.

export * from "./normalize.js";
export { DUPLICATE_SIGNALS, gradeMatch } from "./scoring.js";
export { DUPLICATE_PERMISSIONS, DUPLICATE_RECORD_TYPES, canOverrideDuplicates, recordDuplicateOverride } from "./policy.js";
export { markNotDuplicate, unmarkNotDuplicate } from "./decisions.js";
export { DUPLICATE_QUEUE_TYPES, listDuplicateQueue } from "./queue.js";
export { getDuplicateRules, listMergedRecords, listNotDuplicates } from "./review.js";

// The two review-file columns for a row that matched an existing record.
export function importDuplicateColumns(match) {
  if (!match) return { matchingRecord: null, matchField: null };
  const kind = { lead: "Lead", contact: "Contact", account: "Account" }[match.kind] ?? "Record";
  return {
    matchingRecord: match.canOpen === false ? `${kind} you cannot open` : `${kind} ${[match.code, match.name].filter(Boolean).join(" ")}`.trim(),
    matchField: (match.reasons ?? []).map((reason) => reason.label).join("; ") || null,
  };
}
