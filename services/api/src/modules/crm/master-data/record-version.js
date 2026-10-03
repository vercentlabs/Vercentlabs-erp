import { CrmError } from "../data-management/errors.js";

// Shared optimistic-concurrency helper for Contact ordinary edits.
// Used by updateCrmContact and its archive counterparts.
// Mirrors the exact contract Lead
// updates already use (assertLeadExpectedVersion / CRM_STALE_WRITE), so the
// web client's conflict-handling code (typed 409, "Refresh and try again")
// works identically for Contacts.
export function assertExpectedRecordVersion(
  record,
  expectedUpdatedAt,
  { entityLabel, codePrefix, required = false } = {},
) {
  const supplied = String(expectedUpdatedAt || "").trim();
  if (!supplied) {
    if (required)
      throw new CrmError(
        400,
        `Refresh this ${entityLabel} before changing it.`,
        `${codePrefix}_VERSION_REQUIRED`,
      );
    return;
  }
  const expected = new Date(supplied);
  if (!Number.isFinite(expected.getTime()))
    throw new CrmError(
      400,
      `The ${entityLabel} version is invalid. Refresh and try again.`,
      `${codePrefix}_VERSION_INVALID`,
    );
  const actual = new Date(record.updatedAt ?? "");
  if (!Number.isFinite(actual.getTime()) || expected.getTime() !== actual.getTime())
    throw new CrmError(
      409,
      `This ${entityLabel} changed after you loaded it. Refresh and try again.`,
      "CRM_STALE_WRITE",
    );
}
