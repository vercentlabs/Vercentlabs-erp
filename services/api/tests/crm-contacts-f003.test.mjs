import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeContactInput,
  validateContactInput,
} from "../src/modules/crm/features/contacts/record-validation.js";
import {
  archiveCrmContact,
  createCrmContact,
  getCrmContactForCaller,
  listCrmContacts,
  reactivateCrmContact,
  updateCrmContact,
} from "../src/modules/crm/contact-operations.js";

const context = Object.freeze({
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  activeCompanyId: "33333333-3333-4333-8333-333333333333",
  activeBranchId: null,
  allowAllCompanies: false,
  permissions: ["crm.view", "parties.manage", "crm.contacts.view_sensitive"],
  roleSlugs: ["crm_manager"],
});
const restrictedContext = Object.freeze({
  ...context,
  permissions: ["crm.view", "parties.manage"],
});
const accountId = "44444444-4444-4444-8444-444444444444";
const contactId = "55555555-5555-4555-8555-555555555555";

const accountRow = Object.freeze({
  id: accountId,
  organization_id: context.organizationId,
  company_id: context.activeCompanyId,
  code: "PTY-00001",
  party_type: "prospect",
  display_name: "Acme Manufacturing",
  status: "active",
});

const contactRow = Object.freeze({
  id: contactId,
  organization_id: context.organizationId,
  party_id: accountId,
  first_name: "Rahul",
  last_name: "Sharma",
  designation: "Sales Director",
  email: "rahul@acme.example",
  mobile: "+91 99999 99999",
  phone: null,
  is_primary: true,
  status: "active",
  account_name: "Acme Manufacturing",
  account_status: "active",
  account_company_id: context.activeCompanyId,
  account_city: "Pune",
  account_state: "Maharashtra",
  account_country_code: "IN",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
});

test("F003: first name is required and whitespace-only names are rejected", () => {
  for (const firstName of ["", "   "]) {
    const errors = validateContactInput({ firstName, email: "person@example.com" });
    assert.equal(errors.some((error) => error.code === "CRM_CONTACT_NAME_REQUIRED"), true);
  }
});

test("F003: contact input trims names and channels and lowercases email", () => {
  assert.deepEqual(
    normalizeContactInput({
      firstName: "  Rahul ",
      lastName: " Sharma  ",
      designation: "   ",
      email: " RAHUL@ACME.EXAMPLE ",
      mobile: " +91 99999 99999 ",
      accountId: "",
    }),
    {
      firstName: "Rahul",
      lastName: "Sharma",
      designation: null,
      email: "rahul@acme.example",
      mobile: "+91 99999 99999",
      accountId: null,
    },
  );
});

test("F003: email-only, mobile-only and phone-only contacts are valid", () => {
  assert.deepEqual(validateContactInput({ firstName: "Amit", email: "amit@example.com" }), []);
  assert.deepEqual(validateContactInput({ firstName: "Amit", mobile: "+44 20 7946 0958" }), []);
  assert.deepEqual(validateContactInput({ firstName: "Amit", phone: "+1 (415) 555-0198 ext 2" }), []);
});

test("F003: missing reachability, invalid email and obvious invalid phone are rejected", () => {
  assert.equal(validateContactInput({ firstName: "Amit" }).some((error) => error.code === "CRM_CONTACT_CONTACT_METHOD_REQUIRED"), true);
  assert.equal(validateContactInput({ firstName: "Amit", email: "amit@" }).some((error) => error.code === "CRM_CONTACT_EMAIL_INVALID"), true);
  assert.equal(validateContactInput({ firstName: "Amit", mobile: "call-me" }).some((error) => error.code === "CRM_CONTACT_PHONE_INVALID"), true);
});

function lifecycleClient({ linked = true, accountStatus = "active", accountVisible = true } = {}) {
  const calls = [];
  let state = { ...contactRow, party_id: linked ? accountId : null, account_name: linked ? accountRow.display_name : null };
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.business_parties account")) {
        return accountVisible ? { rows: [{ ...accountRow, status: accountStatus }] } : { rows: [] };
      }
      if (sql.includes("AS contacts") && sql.includes("AS opportunities")) {
        return { rows: [{ contacts: 1, opportunities: 0 }] };
      }
      if (sql.includes("SELECT 1 FROM tenant.contacts") && sql.includes("is_primary = true")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO tenant.contacts")) {
        state = {
          ...state,
          id: contactId,
          party_id: values[1],
          first_name: values[2],
          last_name: values[3],
          designation: values[4],
          email: values[5],
          phone: values[6],
          mobile: values[7],
          is_primary: values[8],
          account_name: values[1] ? accountRow.display_name : null,
        };
        return { rows: [{ id: contactId }] };
      }
      if (sql.includes("UPDATE tenant.contacts") && sql.includes("status = 'inactive'")) {
        state = { ...state, status: "inactive", is_primary: false, archived_at: "2026-08-25T00:00:00.000Z" };
        return { rows: [] };
      }
      if (sql.includes("UPDATE tenant.contacts") && sql.includes("status = 'active'")) {
        state = { ...state, status: "active", archived_at: null };
        return { rows: [] };
      }
      if (sql.includes("UPDATE tenant.contacts") && sql.includes("designation =")) {
        state = { ...state, designation: values[2] };
        return { rows: [] };
      }
      if (sql.includes("UPDATE tenant.contacts") && sql.includes("SET party_id =")) {
        state = { ...state, party_id: values[2], account_name: values[2] ? accountRow.display_name : null, is_primary: false };
        return { rows: [] };
      }
      if (sql.includes("FROM tenant.contacts contact")) return { rows: [state] };
      if (sql.includes("AS opportunities") && sql.includes("AS activities")) {
        return { rows: [{ opportunities: 2, activities: 4 }] };
      }
      return { rows: [] };
    },
  };
}

function duplicateBlockingContactClient() {
  const calls = [];
  const inserted = [];
  return {
    calls,
    inserted,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("SELECT * FROM tenant.crm_duplicate_rules")) {
        return { rows: [{ signal: "email", method: "exact", weight: 70, fuzzy_threshold: null, enabled: true, blocking: true }] };
      }
      if (sql.includes("SELECT max(updated_at) AS at FROM tenant.crm_duplicate_rules")) {
        return { rows: [{ at: new Date("2026-01-01") }] };
      }
      if (sql.includes("SELECT DISTINCT unnest(matched_contact_ids)")) {
        return { rows: [] };
      }
      if (/FROM tenant\.contacts contact\s/.test(sql)) {
        return {
          rows: [
            {
              id: "88888888-8888-4888-8888-888888888888",
              first_name: "Priya",
              last_name: "Shah",
              email: "priya@example.com",
              match_score: 70,
              matched_signals: ["email"],
              classification: "exact",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO tenant.contacts")) {
        return { rows: [{ id: "77777777-7777-4777-8777-777777777777" }] };
      }
      if (sql.includes("INSERT INTO tenant.crm_contact_duplicate_overrides")) {
        inserted.push(values);
        return { rows: [{ id: "override-1" }] };
      }
      if (/^SELECT.*FROM tenant\.contacts contact.*WHERE contact\.organization_id = \$1\s+AND contact\.id = \$2/s.test(sql)) {
        return { rows: [{ id: "77777777-7777-4777-8777-777777777777", first_name: "Priya", last_name: "Shah", email: "priya@example.com", status: "active", party_id: null }] };
      }
      if (sql.includes("AS opportunities") && sql.includes("AS activities")) {
        return { rows: [{ opportunities: 0, activities: 0 }] };
      }
      return { rows: [] };
    },
  };
}

test("F003/F008: creating a Contact that exactly matches an existing email is blocked without an override reason", async () => {
  const client = duplicateBlockingContactClient();
  await assert.rejects(
    () => createCrmContact(client, context, { firstName: "Priya", lastName: "Shah", email: "priya@example.com" }),
    (error) => error.code === "CRM_CONTACT_DUPLICATE_EXACT" && error.status === 409,
  );
  assert.equal(client.calls.some((c) => c.sql.includes("INSERT INTO tenant.contacts")), false);
});

test("F003/F008: an authorized caller with a valid reason may create the exact duplicate Contact, recorded as immutable evidence", async () => {
  const client = duplicateBlockingContactClient();
  const overrideContext = { ...context, permissions: [...context.permissions, "crm.accounts.manage"] };
  await createCrmContact(client, overrideContext, {
    firstName: "Priya",
    lastName: "Shah",
    email: "priya@example.com",
    duplicateOverrideReason: "Confirmed two different people who happen to share an email alias",
  });
  assert.equal(client.inserted.length, 1);
  assert.equal(client.inserted[0][3], "create");
});

test("F003: standalone Contact creation persists without fabricating an Account", async () => {
  const client = lifecycleClient({ linked: false });
  const created = await createCrmContact(client, context, { firstName: " Priya ", email: " PRIYA@EXAMPLE.COM " });
  assert.equal(created.accountId, null);
  const insert = client.calls.find((call) => call.sql.includes("INSERT INTO tenant.contacts"));
  assert.equal(insert.values[1], null);
  assert.equal(insert.values[2], "Priya");
  assert.equal(insert.values[5], "priya@example.com");
  assert.equal(insert.values[8], false);
  const outbox = client.calls.find((call) => call.sql.includes("INSERT INTO tenant.crm_outbox_events"));
  assert.equal(outbox.values[1], "crm.contacts.created");
});

test("F003: linked Contact creation validates the scoped active Account and selects the first primary", async () => {
  const client = lifecycleClient();
  const created = await createCrmContact(client, context, { firstName: "Rahul", mobile: "+91 99999 99999", accountId });
  assert.equal(created.accountId, accountId);
  const insert = client.calls.find((call) => call.sql.includes("INSERT INTO tenant.contacts"));
  assert.equal(insert.values[1], accountId);
  assert.equal(insert.values[8], true);
  assert.equal(client.calls.some((call) => call.values?.includes(context.activeCompanyId)), true);
});

test("F003: inaccessible and archived Account assignments fail safely", async () => {
  await assert.rejects(
    () => createCrmContact(lifecycleClient({ accountVisible: false }), context, { firstName: "Rahul", email: "r@example.com", accountId }),
    (error) => error.code === "CRM_CONTACT_ACCOUNT_NOT_FOUND" && error.status === 404,
  );
  await assert.rejects(
    () => createCrmContact(lifecycleClient({ accountStatus: "inactive" }), context, { firstName: "Rahul", email: "r@example.com", accountId }),
    (error) => error.code === "CRM_CONTACT_ACCOUNT_ARCHIVED" && error.status === 409,
  );
});

test("F003: server search, Account filter and pagination stay organization/company scoped", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("count(*)::int AS count")) return { rows: [{ count: 1 }] };
      return { rows: [contactRow] };
    },
  };
  const result = await listCrmContacts(client, context, { search: "Rahul", accountId, status: "active", limit: 25, offset: 0 });
  assert.equal(result.total, 1);
  assert.equal(result.rows[0].firstName, "Rahul");
  assert.match(calls[0].sql, /to_tsvector/);
  assert.match(calls[0].sql, /FROM \(\s*SELECT contact\.\*/);
  assert.doesNotMatch(calls[0].sql, /count\(\*\)::int AS count\s+SELECT/);
  assert.match(calls[0].sql, /account\.display_name/);
  assert.match(calls[0].sql, /contact\.party_id =/);
  assert.equal(calls.some((call) => call.values?.includes(context.activeCompanyId)), true);
});

test("F003: partial update preserves omitted identity, channels and Account", async () => {
  const client = lifecycleClient();
  const updated = await updateCrmContact(client, context, contactId, { designation: "VP Sales" });
  assert.equal(updated.email, contactRow.email);
  assert.equal(updated.mobile, contactRow.mobile);
  assert.equal(updated.accountId, accountId);
  const update = client.calls.find((call) => call.sql.includes("designation ="));
  assert.doesNotMatch(update.sql, /email =|mobile =|party_id =/);
  const outbox = client.calls.find((call) => call.sql.includes("INSERT INTO tenant.crm_outbox_events"));
  assert.equal(outbox.values[1], "crm.contacts.updated");
});

test("F003: Account unlink is explicit and does not create an Unknown Account", async () => {
  const client = lifecycleClient();
  const updated = await updateCrmContact(client, context, contactId, { accountId: null });
  assert.equal(updated.accountId, null);
  assert.equal(updated.isPrimary, false);
});

test("F003: archive is soft and preserves Account and related-record counts", async () => {
  const client = lifecycleClient();
  const archived = await archiveCrmContact(client, context, contactId);
  assert.equal(archived.status, "inactive");
  assert.equal(archived.accountId, accountId);
  assert.deepEqual(archived.relationships, { opportunities: 2, activities: 4 });
  assert.equal(client.calls.some((call) => /\bDELETE\b/i.test(call.sql)), false);
  const outbox = client.calls.find((call) => call.sql.includes("INSERT INTO tenant.crm_outbox_events"));
  assert.equal(outbox.values[1], "crm.contacts.archived");
});

test("F003: reactivate restores an archived Contact whose Account is still active", async () => {
  const client = lifecycleClient();
  await archiveCrmContact(client, context, contactId);
  const reactivated = await reactivateCrmContact(client, context, contactId);
  assert.equal(reactivated.status, "active");
  assert.equal(reactivated.accountId, accountId);
  const outbox = client.calls
    .filter((call) => call.sql.includes("INSERT INTO tenant.crm_outbox_events"))
    .at(-1);
  assert.equal(outbox.values[1], "crm.contacts.reactivated");
});

test("F003: reactivate on an already-active Contact is idempotent and queues no duplicate event", async () => {
  const client = lifecycleClient();
  const before = client.calls.length;
  const reactivated = await reactivateCrmContact(client, context, contactId);
  assert.equal(reactivated.status, "active");
  const newOutboxWrites = client.calls
    .slice(before)
    .filter((call) => call.sql.includes("INSERT INTO tenant.crm_outbox_events"));
  assert.equal(newOutboxWrites.length, 0);
});

test("F003: reactivate is blocked while the linked Account is still archived", async () => {
  const client = lifecycleClient({ accountStatus: "inactive" });
  await archiveCrmContact(client, context, contactId);
  await assert.rejects(
    () => reactivateCrmContact(client, context, contactId),
    (error) => error.code === "CRM_CONTACT_ACCOUNT_ARCHIVED" && error.status === 409,
  );
});

test("F003 QA: repeated archive is idempotent at the lifecycle-event boundary", async () => {
  const client = lifecycleClient();
  await archiveCrmContact(client, context, contactId);
  await archiveCrmContact(client, context, contactId);
  const archiveEvents = client.calls.filter(
    (call) =>
      call.sql.includes("INSERT INTO tenant.crm_outbox_events") &&
      call.values?.[1] === "crm.contacts.archived",
  );
  assert.equal(archiveEvents.length, 1);
});

test("F003 SEC: a restricted viewer never sees email/phone/mobile on list or detail", async () => {
  const listClient = {
    async query(sql) {
      if (sql.includes("count(*)::int AS count")) return { rows: [{ count: 1 }] };
      return { rows: [contactRow] };
    },
  };
  const list = await listCrmContacts(listClient, restrictedContext, {});
  assert.equal(list.rows[0].email, undefined);
  assert.equal(list.rows[0].mobile, undefined);
  assert.equal(list.rows[0].sensitiveDataRestricted, true);
  assert.equal(list.rows[0].firstName, "Rahul");

  const detail = await getCrmContactForCaller(lifecycleClient(), restrictedContext, contactId);
  assert.equal(detail.email, undefined);
  assert.equal(detail.mobile, undefined);
  assert.equal(detail.sensitiveDataRestricted, true);
});

test("F003 SEC: normalizedEmail/normalizedMobile (GENERATED columns, migration 091) are redacted for a restricted viewer too — regression found by erp-crm-sensitive-projection.spec.ts", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("FROM tenant.contacts contact")) {
        return {
          rows: [
            {
              ...contactRow,
              normalized_email: "rahul@acme.example",
              normalized_mobile: "919999999999",
            },
          ],
        };
      }
      if (sql.includes("AS opportunities") && sql.includes("AS activities")) {
        return { rows: [{ opportunities: 0, activities: 0 }] };
      }
      return { rows: [] };
    },
  };
  const detail = await getCrmContactForCaller(client, restrictedContext, contactId);
  assert.equal(detail.normalizedEmail, undefined);
  assert.equal(detail.normalizedMobile, undefined);
  assert.equal(detail.sensitiveDataRestricted, true);
});

test("F003 SEC: an authorized viewer still sees email/phone/mobile", async () => {
  const client = {
    async query(sql) {
      if (sql.includes("count(*)::int AS count")) return { rows: [{ count: 1 }] };
      return { rows: [contactRow] };
    },
  };
  const list = await listCrmContacts(client, context, {});
  assert.equal(list.rows[0].email, contactRow.email);
  assert.equal(list.rows[0].sensitiveDataRestricted, undefined);
});

test("F003 SEC: a restricted user cannot set email/phone/mobile on create or update", async () => {
  await assert.rejects(
    () => createCrmContact(lifecycleClient({ linked: false }), restrictedContext, { firstName: "Priya", email: "priya@example.com" }),
    (error) => error.status === 403 && error.code === "CRM_CONTACT_SENSITIVE_FIELD_FORBIDDEN",
  );
  await assert.rejects(
    () => updateCrmContact(lifecycleClient(), restrictedContext, contactId, { mobile: "+91 90000 00000" }),
    (error) => error.status === 403 && error.code === "CRM_CONTACT_SENSITIVE_FIELD_FORBIDDEN",
  );
  // Non-sensitive fields remain editable without the sensitive permission.
  const updated = await updateCrmContact(lifecycleClient(), restrictedContext, contactId, { designation: "VP Sales" });
  assert.equal(updated.designation, "VP Sales");
});

test("F003 SEC: restricted search cannot match on email/phone/mobile, and doesn't select those columns for tsvector", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("count(*)::int AS count")) return { rows: [{ count: 0 }] };
      return { rows: [] };
    },
  };
  await listCrmContacts(client, restrictedContext, { search: "rahul@acme.example" });
  assert.doesNotMatch(calls[0].sql, /contact\.email/);
  assert.doesNotMatch(calls[0].sql, /contact\.mobile/);
  assert.doesNotMatch(calls[0].sql, /contact\.phone/);
});

test("F003: fabricated owner and scope assignments are rejected server-side", async () => {
  for (const input of [{ ownerUserId: contactId }, { companyId: context.activeCompanyId }, { branchId: contactId }]) {
    await assert.rejects(
      () => updateCrmContact(lifecycleClient(), context, contactId, input),
      (error) => error.status === 403 && /FORBIDDEN/.test(error.code),
    );
  }
});

// --- CRM-VNEXT-036: preferred language / IANA timezone -------------------

test("F003 language/timezone: a valid BCP-47 language tag and IANA zone are accepted", () => {
  const errors = validateContactInput({
    firstName: "Priya",
    email: "priya@example.com",
    preferredLanguage: "en-IN",
    timezone: "Asia/Kolkata",
  });
  assert.equal(errors.length, 0);
});

test("F003 language/timezone: a bogus language tag and a non-IANA timezone are both rejected with actionable codes", () => {
  const errors = validateContactInput({
    firstName: "Priya",
    email: "priya@example.com",
    // Underscore instead of hyphen (a common ambiguous-locale-string
    // mistake the dossier explicitly calls out) is not valid BCP-47 syntax.
    preferredLanguage: "en_US",
    timezone: "Mars/Olympus_Mons",
  });
  assert.ok(errors.some((e) => e.code === "CRM_CONTACT_LANGUAGE_INVALID"));
  assert.ok(errors.some((e) => e.code === "CRM_CONTACT_TIMEZONE_INVALID"));
});

test("F003 language/timezone: an offset-style string ('GMT+5:30') is rejected — only canonical IANA identifiers are accepted", () => {
  const errors = validateContactInput({
    firstName: "Priya",
    email: "priya@example.com",
    timezone: "GMT+5:30",
  });
  assert.ok(errors.some((e) => e.code === "CRM_CONTACT_TIMEZONE_INVALID"));
});

test("F003 language/timezone: empty values are valid (both fields are optional)", () => {
  const errors = validateContactInput({
    firstName: "Priya",
    email: "priya@example.com",
    preferredLanguage: "",
    timezone: "",
  });
  assert.equal(errors.length, 0);
});

test("F003 language/timezone: create persists preferred language and timezone", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("INSERT INTO tenant.contacts")) return { rows: [{ id: contactId }] };
      if (sql.includes("FROM tenant.contacts contact")) {
        return {
          rows: [
            {
              ...contactRow,
              preferred_language: "en-IN",
              timezone: "Asia/Kolkata",
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const created = await createCrmContact(client, context, {
    firstName: "Priya",
    email: "priya@example.com",
    preferredLanguage: "en-IN",
    timezone: "Asia/Kolkata",
  });
  assert.equal(created.preferredLanguage, "en-IN");
  assert.equal(created.timezone, "Asia/Kolkata");
  const insert = calls.find((call) => call.sql.includes("INSERT INTO tenant.contacts"));
  assert.ok(insert.values.includes("en-IN"));
  assert.ok(insert.values.includes("Asia/Kolkata"));
});

test("F003 language/timezone: update can change only the timezone without touching other fields", async () => {
  const client = lifecycleClient();
  const updated = await updateCrmContact(client, context, contactId, {
    timezone: "America/New_York",
  });
  const update = client.calls.find((call) => call.sql.includes("UPDATE tenant.contacts"));
  assert.match(update.sql, /timezone = /);
  assert.doesNotMatch(update.sql, /preferred_language = /);
  assert.equal(updated.email, contactRow.email, "unrelated fields are untouched");
});
