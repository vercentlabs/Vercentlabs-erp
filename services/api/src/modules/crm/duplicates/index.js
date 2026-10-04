// Duplicate detection for CRM. One service, three matchers:
//
//   findDuplicates(type, input)   what already looks like this record
//   checkBeforeCreate             the same, refusing a strong duplicate
//   checkBeforeConversion         the account and contact a lead would become
//   checkImportRow                the same check, phrased for an import report
//   markNotDuplicate, listDuplicateQueue, recordDuplicateOverride
//
// The matchers live with their records (leads/, contacts/, accounts/) and
// share the normalization, grading and policy here, so "the same email" means
// the same thing wherever it is asked. Every check is scoped to the caller's
// organization; nothing is ever compared across organizations.
import { assertNoBlockingAccountDuplicate, findDuplicateAccounts } from "../accounts/duplicates.js";
import { assertNoBlockingContactDuplicate, findDuplicateContacts } from "../contacts/duplicates.js";
import { CrmError } from "../data-management/errors.js";
import { assertNoBlockingLeadDuplicate, findLeadDuplicates } from "../leads/duplicates.js";

export * from "./normalize.js";
export { DUPLICATE_SIGNALS, gradeMatch } from "./scoring.js";
export { DUPLICATE_PERMISSIONS, DUPLICATE_RECORD_TYPES, canOverrideDuplicates, recordDuplicateOverride } from "./policy.js";
export { markNotDuplicate, unmarkNotDuplicate } from "./decisions.js";
export { DUPLICATE_QUEUE_TYPES, listDuplicateQueue } from "./queue.js";
export { getDuplicateRules, listMergedRecords, listNotDuplicates } from "./review.js";

const MATCHERS = Object.freeze({
  lead: { find: (client, context, input, options) => findLeadDuplicates(client, context, input, { excludeLeadId: options.excludeId, limit: options.limit ?? 10 }),
    check: (client, context, input, options) => assertNoBlockingLeadDuplicate(client, context, input, { ...options, excludeLeadId: options.excludeId }) },
  contact: { find: findDuplicateContacts, check: assertNoBlockingContactDuplicate },
  account: { find: findDuplicateAccounts, check: assertNoBlockingAccountDuplicate },
});

function matcher(type) {
  if (!MATCHERS[type]) throw new CrmError(400, "Duplicates can be checked for leads, contacts and accounts.", "CRM_DUPLICATE_VALIDATION");
  return MATCHERS[type];
}

// type: "lead" | "contact" | "account". options: { excludeId?, limit? }
export function findDuplicates(client, context, type, input = {}, options = {}) {
  return matcher(type).find(client, context, input, options);
}

// options: { excludeId?, allowDuplicate?, reason? }. Throws on a strong duplicate.
export function checkBeforeCreate(client, context, type, input = {}, options = {}) {
  return matcher(type).check(client, context, input, options);
}

// The account and the contact a lead would become: use the existing one where there is a match.
export async function checkBeforeConversion(client, context, lead = {}) {
  const account = lead.companyName
    ? await findDuplicateAccounts(client, context, { displayName: lead.companyName, website: lead.website, email: lead.email, phone: lead.phone, city: lead.city })
    : { matches: [], hasBlockingMatch: false };
  const contact = await findDuplicateContacts(client, context, {
    firstName: lead.firstName || lead.lastName, lastName: lead.firstName ? lead.lastName : null, email: lead.email, mobile: lead.mobile, phone: lead.phone,
    accountId: account.matches[0]?.id,
  });
  return { account, contact };
}

// One import row: { outcome: "create" | "possible" | "strong", match, matchingRecord, matchField }
export async function checkImportRow(client, context, type, input = {}) {
  const { matches } = await findDuplicates(client, context, type, input);
  const match = matches[0] ?? null;
  return { outcome: !match ? "create" : match.strength === "exact" ? "strong" : "possible", match, ...importDuplicateColumns(match) };
}

// The two review-file columns for a row that matched an existing record.
export function importDuplicateColumns(match) {
  if (!match) return { matchingRecord: null, matchField: null };
  const kind = { lead: "Lead", contact: "Contact", account: "Account" }[match.kind] ?? "Record";
  return {
    matchingRecord: match.canOpen === false ? `${kind} you cannot open` : `${kind} ${[match.code, match.name].filter(Boolean).join(" ")}`.trim(),
    matchField: (match.reasons ?? []).map((reason) => reason.label).join("; ") || null,
  };
}
