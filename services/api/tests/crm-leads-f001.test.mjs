import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeLeadRecordInput,
  validateLeadRecord,
} from "../src/modules/crm/features/leads/record-validation.js";

test("F001: a lead requires first name and at least one contact method", () => {
  const errors = validateLeadRecord({ firstName: "", companyName: "Acme" });
  assert.equal(
    errors.some((error) => error.code === "CRM_LEAD_FIRST_NAME_REQUIRED"),
    true,
  );
  assert.equal(
    errors.some((error) => error.code === "CRM_LEAD_CONTACT_REQUIRED"),
    true,
  );
});

test("F001: email-only leads are valid and mobile is not mandatory", () => {
  const errors = validateLeadRecord({
    firstName: "Asha",
    email: "asha@example.com",
  });
  assert.deepEqual(errors, []);
});

test("F001: phone-only leads are valid", () => {
  const errors = validateLeadRecord({
    firstName: "Asha",
    phone: "+91 20 5555 0100",
  });
  assert.deepEqual(errors, []);
});

test("F001: normalized lead input trims text and canonicalizes email/currency/country", () => {
  assert.deepEqual(
    normalizeLeadRecordInput({
      firstName: "  Asha ",
      email: "  ASHA@EXAMPLE.COM ",
      mobile: "   ",
      currencyCode: "inr",
      countryCode: "in",
    }),
    {
      firstName: "Asha",
      email: "asha@example.com",
      mobile: null,
      currencyCode: "INR",
      countryCode: "IN",
    },
  );
});

test("F001: invalid lead contact and commercial values are rejected", () => {
  const errors = validateLeadRecord({
    firstName: "Asha",
    email: "not-an-email",
    website: "javascript:alert(1)",
    estimatedValue: -1,
    currencyCode: "rupees",
    countryCode: "IND",
  });
  for (const code of [
    "CRM_LEAD_EMAIL_INVALID",
    "CRM_LEAD_WEBSITE_INVALID",
    "CRM_LEAD_ESTIMATED_VALUE_INVALID",
    "CRM_LEAD_CURRENCY_INVALID",
    "CRM_LEAD_COUNTRY_INVALID",
  ]) {
    assert.equal(
      errors.some((error) => error.code === code),
      true,
      code,
    );
  }
});

test("F001: a newly-created lead cannot begin converted or archived", () => {
  for (const status of ["converted", "archived"]) {
    const errors = validateLeadRecord({
      firstName: "Asha",
      email: "a@example.com",
      status,
    });
    assert.equal(
      errors.some((error) => error.code === "CRM_LEAD_INITIAL_STATUS_INVALID"),
      true,
    );
  }
});

test("F001: update validation evaluates the complete record, not only the patch", () => {
  const existing = {
    firstName: "Asha",
    email: "asha@example.com",
    status: "new",
  };
  assert.deepEqual(
    validateLeadRecord({ companyName: "Acme" }, { mode: "update", existing }),
    [],
  );
  const errors = validateLeadRecord(
    { email: null },
    { mode: "update", existing: { ...existing, mobile: null, phone: null } },
  );
  assert.equal(
    errors.some((error) => error.code === "CRM_LEAD_CONTACT_REQUIRED"),
    true,
  );
});
