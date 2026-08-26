import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeLeadRecordInput,
  validateLeadRecord,
} from "../src/modules/crm/features/leads/record-validation.js";
import { listCrmRecords } from "../src/modules/crm/index.js";

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

test("F001: whitespace-only first name is rejected", () => {
  const errors = validateLeadRecord({
    firstName: "   ",
    mobile: "+91 99999 99999",
  });
  assert.equal(
    errors.some((error) => error.code === "CRM_LEAD_FIRST_NAME_REQUIRED"),
    true,
  );
});

test("F001: mobile-only leads are valid", () => {
  assert.deepEqual(
    validateLeadRecord({ firstName: "Asha", mobile: "+91 99999 99999" }),
    [],
  );
});

test("F001: phone-only leads are valid", () => {
  const errors = validateLeadRecord({
    firstName: "Asha",
    phone: "+91 20 5555 0100",
  });
  assert.deepEqual(errors, []);
});

test("F001 QA: alphabetic and punctuation-only phone channels are rejected", () => {
  for (const phone of ["abc", "+()-abc"]) {
    const errors = validateLeadRecord({ firstName: "Asha", phone });
    assert.equal(
      errors.some((error) => error.code === "CRM_LEAD_PHONE_INVALID"),
      true,
      phone,
    );
  }
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
  assert.deepEqual(
    normalizeLeadRecordInput({ currencyCode: "   ", countryCode: " " }),
    { currencyCode: null, countryCode: null },
  );
});

test("F001: a blank optional estimated value uses the database-safe zero default", () => {
  assert.equal(normalizeLeadRecordInput({ estimatedValue: null }).estimatedValue, 0);
  assert.equal(normalizeLeadRecordInput({ estimatedValue: "" }).estimatedValue, 0);
  assert.equal(normalizeLeadRecordInput({ estimatedValue: "1250.50" }).estimatedValue, 1250.5);
});

test("F001: invalid email is rejected independently", () => {
  const errors = validateLeadRecord({ firstName: "Asha", email: "asha@" });
  assert.equal(
    errors.some((error) => error.code === "CRM_LEAD_EMAIL_INVALID"),
    true,
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

test("F001 QA: estimated value is bounded before numeric(18,2) persistence", () => {
  const errors = validateLeadRecord({
    firstName: "Asha",
    email: "asha@example.com",
    estimatedValue: "999999999999999999999999999",
  });
  assert.equal(
    errors.some((error) => error.code === "CRM_LEAD_ESTIMATED_VALUE_INVALID"),
    true,
  );
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

test("F001: a valid partial update preserves persisted reachability", () => {
  assert.deepEqual(
    validateLeadRecord(
      { companyName: "Vercent Labs" },
      {
        mode: "update",
        existing: {
          firstName: "Asha",
          email: null,
          mobile: "+91 99999 99999",
          phone: null,
          status: "new",
        },
      },
    ),
    [],
  );
});

test("F001: the default Lead collection excludes archived records", async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      return sql.includes("count(*)")
        ? { rows: [{ total: 0 }] }
        : { rows: [] };
    },
  };
  await listCrmRecords(
    client,
    {
      organizationId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      activeCompanyId: "33333333-3333-4333-8333-333333333333",
      activeBranchId: "44444444-4444-4444-8444-444444444444",
      allowAllCompanies: false,
      permissions: ["crm.records.view_all"],
      roleSlugs: [],
    },
    "leads",
    {},
  );
  assert.equal(
    statements.every((sql) => sql.includes("record.record_status = 'active'")),
    true,
  );
});

test("F001: archived Leads remain deliberately discoverable", async () => {
  const statements = [];
  const client = {
    async query(sql) {
      statements.push(sql);
      return sql.includes("count(*)")
        ? { rows: [{ total: 0 }] }
        : { rows: [] };
    },
  };
  await listCrmRecords(
    client,
    {
      organizationId: "11111111-1111-4111-8111-111111111111",
      userId: "22222222-2222-4222-8222-222222222222",
      activeCompanyId: "33333333-3333-4333-8333-333333333333",
      activeBranchId: "44444444-4444-4444-8444-444444444444",
      allowAllCompanies: false,
      permissions: ["crm.records.view_all"],
      roleSlugs: [],
    },
    "leads",
    { status: "archived" },
  );
  assert.equal(
    statements.every((sql) => sql.includes("record.record_status =")),
    true,
  );
  assert.equal(
    statements.some((sql) => sql.includes("record.record_status = 'active'")),
    false,
  );
});
