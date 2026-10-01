// Email address validation shared by email, provider normalisation and
// public meeting booking: one rule for what counts as an address.

import { CrmCommunicationsError } from "./communications-error.js";

const text = (value) => String(value ?? "").trim();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmailAddress(value) {
  const result = text(value).toLowerCase();
  if (!EMAIL.test(result)) {
    throw new CrmCommunicationsError(
      400,
      "Email address is invalid.",
      "CRM_EMAIL_INVALID",
    );
  }
  return result;
}

export function optionalEmail(value) {
  const result = text(value).toLowerCase();
  return result && EMAIL.test(result) ? result : null;
}
