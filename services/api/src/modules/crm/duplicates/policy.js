// What happens when a save matches an existing record. Every create and
// update of a lead, contact or account goes through enforceDuplicatePolicy,
// whether it comes from a form, an import, an integration or a conversion,
// so the browser's warning is never the only check.
//
//   no match / possible   the save continues
//   strong                refused with the matching records, unless the
//                         caller holds crm.duplicates.override and gives a
//                         reason; the override is then recorded
import { CrmError } from "../data-management/errors.js";

export const DUPLICATE_PERMISSIONS = Object.freeze({ override: "crm.duplicates.override", review: "crm.duplicates.review" });
export const DUPLICATE_RECORD_TYPES = Object.freeze(["lead", "contact", "account"]);

const text = (value) => String(value ?? "").trim();

export function canOverrideDuplicates(context) {
  return Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(DUPLICATE_PERMISSIONS.override));
}

// Two people saving the same new company at the same moment would both see
// "no duplicate". Taking a lock on each strong key first makes the second
// save wait for the first, and then see its record.
export async function lockDuplicateKeys(client, context, recordType, keys) {
  const unique = [...new Set(keys.filter(Boolean).map((key) => `${context.organizationId}:${recordType}:${key}`))].sort();
  for (const key of unique) await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [key]);
}

// result: what the matcher returned ({ matches, hasBlockingMatch }).
// options: allowDuplicate (the caller chose to save anyway), reason, the
// error code and message to refuse with.
// Returns the result, with `override` set when a strong match was overridden.
export function enforceDuplicatePolicy(context, result, { allowDuplicate = false, reason = null, code, message }) {
  if (!result.hasBlockingMatch) return result;
  const canOverride = canOverrideDuplicates(context);
  const strong = result.matches.filter((match) => match.strength === "exact");
  if (!allowDuplicate)
    throw new CrmError(409, message, code, {
      duplicateDetected: true, matchStrength: "strong", canOverride,
      matchedRecordId: strong[0]?.id ?? null, matchedFields: strong[0]?.signals ?? [], matches: result.matches,
    });
  if (!canOverride)
    throw new CrmError(403, "You do not have permission to save a record that matches an existing one. Use the existing record, or ask a manager.", "CRM_DUPLICATE_OVERRIDE_FORBIDDEN", {
      duplicateDetected: true, matchStrength: "strong", canOverride: false, matches: result.matches,
    });
  const cleanReason = text(reason).slice(0, 500);
  if (!cleanReason)
    throw new CrmError(400, "Explain why this is not a duplicate of the existing record.", "CRM_DUPLICATE_OVERRIDE_REASON_REQUIRED", {
      duplicateDetected: true, matchStrength: "strong", canOverride: true, matches: result.matches,
    });
  return { ...result, override: { reason: cleanReason, matches: strong } };
}

// Remembers who saved a record although it matched, against what, and why.
// A strong match the caller cannot open is recorded by id all the same.
export async function recordDuplicateOverride(client, context, recordType, recordId, result) {
  if (!result?.override) return;
  for (const match of result.override.matches)
    await client.query(
      `INSERT INTO tenant.crm_duplicate_decisions (organization_id, decision, record_type_a, record_id_a, record_type_b, record_id_b, match_strength, matched_fields, reason, decided_by)
       VALUES ($1, 'override', $2, $3, $4, $5, 'strong', $6, $7, $8)`,
      [context.organizationId, recordType, recordId, match.kind ?? recordType, match.id, match.signals ?? [], result.override.reason, context.userId ?? null],
    );
}
