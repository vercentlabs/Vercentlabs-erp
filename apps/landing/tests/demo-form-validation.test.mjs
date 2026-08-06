import assert from "node:assert/strict";
import test from "node:test";
import { validateDemoForm, isDemoFormValid } from "../lib/demo-form-validation.ts";

const VALID_VALUES = {
  firstName: "Asha",
  lastName: "Kapoor",
  email: "asha@example.com",
  phone: "+91 98765 43210",
  companyName: "Meridian Fabrication Works",
  jobTitle: "Operations Manager",
  industry: "Manufacturing",
  companySize: "51-200",
  primaryInterest: "Manufacturing",
  mainChallenge: "",
  preferredContactTime: "",
  consentEmail: true,
  websiteUrl: "",
  companyWebsiteHidden: "",
};

test("a fully valid submission has no errors", () => {
  assert.deepEqual(validateDemoForm(VALID_VALUES), {});
  assert.equal(isDemoFormValid(VALID_VALUES), true);
});

test("required fields are individually enforced", () => {
  for (const field of ["firstName", "email", "phone", "companyName"]) {
    const errors = validateDemoForm({ ...VALID_VALUES, [field]: "" });
    assert.ok(errors[field], `expected an error for missing "${field}"`);
  }
});

test("role, industry, company size, and primary interest are optional", () => {
  for (const field of ["jobTitle", "industry", "companySize", "primaryInterest"]) {
    const errors = validateDemoForm({ ...VALID_VALUES, [field]: "" });
    assert.ok(!errors[field], `did not expect an error for missing optional field "${field}"`);
  }
});

test("email must look like an email", () => {
  const errors = validateDemoForm({ ...VALID_VALUES, email: "not-an-email" });
  assert.ok(errors.email);
});

test("phone must look like a phone number", () => {
  const errors = validateDemoForm({ ...VALID_VALUES, phone: "call me" });
  assert.ok(errors.phone);
});

test("consent checkbox is required", () => {
  const errors = validateDemoForm({ ...VALID_VALUES, consentEmail: false });
  assert.ok(errors.consentEmail);
});

test("a filled honeypot field is rejected even if every other field is valid", () => {
  const errors = validateDemoForm({ ...VALID_VALUES, websiteUrl: "http://spam.example" });
  assert.ok(errors.websiteUrl);
});

// app/api/book-demo/route.ts calls validateDemoForm on whatever JSON body a
// caller POSTs — not just what the real form UI produces. It must never throw
// on missing/malformed fields; a bad request should be a clean validation
// error (422), never an unhandled 500.
test("does not throw on a completely empty request body", () => {
  assert.doesNotThrow(() => validateDemoForm({}));
  const errors = validateDemoForm({});
  assert.ok(errors.firstName);
  assert.ok(errors.email);
  assert.ok(errors.phone);
  assert.ok(errors.companyName);
  assert.ok(errors.consentEmail);
});

test("does not throw when fields are the wrong type", () => {
  assert.doesNotThrow(() =>
    validateDemoForm({
      firstName: 123,
      email: null,
      phone: undefined,
      companyName: {},
      consentEmail: "yes",
      websiteUrl: ["not", "a", "string"],
    }),
  );
});
