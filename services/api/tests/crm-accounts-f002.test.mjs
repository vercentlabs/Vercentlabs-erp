import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAccountInput,
  validateAccountInput,
} from "../src/modules/crm/prospect-and-relationship-master-data/account-record-validation.js";
import {
  archiveCrmAccount,
  createCrmAccount,
  getCrmAccountForCaller,
  listCrmAccounts,
  updateCrmAccount,
} from "../src/modules/crm/prospect-and-relationship-master-data/account-operations.js";

const context = Object.freeze({
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  activeCompanyId: "33333333-3333-4333-8333-333333333333",
  activeBranchId: null,
  allowAllCompanies: false,
  permissions: ["crm.view", "parties.manage"],
  roleSlugs: ["crm_manager"],
});

const accountRow = Object.freeze({
  id: "44444444-4444-4444-8444-444444444444",
  organization_id: context.organizationId,
  company_id: context.activeCompanyId,
  code: "PTY-00001",
  party_type: "prospect",
  display_name: "Acme Manufacturing",
  legal_name: "Acme Manufacturing Private Limited",
  industry: "Manufacturing",
  website: "https://acme.example",
  phone: "+91 20 5555 0100",
  email: "sales@acme.example",
  currency_code: "INR",
  status: "active",
  address_line1: "Industrial Estate",
  city: "Pune",
  state: "Maharashtra",
  postal_code: "411001",
  country_code: "IN",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
});

test("F002: account name is required and whitespace-only names are rejected", () => {
  for (const displayName of ["", "   "]) {
    const errors = validateAccountInput({ displayName });
    assert.equal(
      errors.some((error) => error.code === "CRM_ACCOUNT_NAME_REQUIRED"),
      true,
    );
  }
});

test("F002: account input trims text and normalizes optional blanks, email, country and currency", () => {
  assert.deepEqual(
    normalizeAccountInput({
      displayName: "  Acme Manufacturing  ",
      legalName: "   ",
      email: "  SALES@ACME.EXAMPLE  ",
      countryCode: "in",
      currencyCode: "inr",
    }),
    {
      displayName: "Acme Manufacturing",
      legalName: null,
      email: "sales@acme.example",
      countryCode: "IN",
      currencyCode: "INR",
    },
  );
});

test("F002: valid email and HTTP(S) websites are accepted", () => {
  assert.deepEqual(
    validateAccountInput({
      displayName: "Acme",
      email: "sales@acme.example",
      website: "https://acme.example",
      countryCode: "IN",
      currencyCode: "INR",
    }),
    [],
  );
});

test("F002: invalid email and unsafe website schemes are rejected independently", () => {
  const errors = validateAccountInput({
    displayName: "Acme",
    email: "sales@",
    website: "javascript:alert(1)",
  });
  assert.equal(
    errors.some((error) => error.code === "CRM_ACCOUNT_EMAIL_INVALID"),
    true,
  );
  assert.equal(
    errors.some((error) => error.code === "CRM_ACCOUNT_WEBSITE_INVALID"),
    true,
  );
});

test("F002: valid account creation uses governed numbering, active company scope and outbox", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("UPDATE public.numbering_series")) {
        return { rows: [{ prefix: "PTY-", number: 42, padding: 5 }] };
      }
      if (sql.includes("INSERT INTO tenant.business_parties")) {
        return { rows: [{ ...accountRow, code: "PTY-00042" }] };
      }
      if (sql.includes("FROM tenant.business_parties account")) {
        return { rows: [{ ...accountRow, code: "PTY-00042" }] };
      }
      if (sql.includes("AS contacts") && sql.includes("AS opportunities")) {
        return { rows: [{ contacts: 0, opportunities: 0 }] };
      }
      return { rows: [] };
    },
  };
  const created = await createCrmAccount(client, context, {
    displayName: "  Acme Manufacturing ",
    email: " SALES@ACME.EXAMPLE ",
    website: "https://acme.example",
  });
  assert.equal(created.code, "PTY-00042");
  const insert = calls.find((call) =>
    call.sql.includes("INSERT INTO tenant.business_parties"),
  );
  assert.equal(insert.values[1], context.activeCompanyId);
  assert.equal(insert.values[4], "Acme Manufacturing");
  assert.equal(insert.values[9], "sales@acme.example");
  const outbox = calls.find((call) =>
    call.sql.includes("INSERT INTO tenant.crm_outbox_events"),
  );
  assert.equal(outbox.values[1], "crm.accounts.created");
});

test("F002: MSME registration number is actually persisted on create (regression — the INSERT column list previously omitted it)", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("UPDATE public.numbering_series")) {
        return { rows: [{ prefix: "PTY-", number: 43, padding: 5 }] };
      }
      if (sql.includes("INSERT INTO tenant.business_parties")) {
        return { rows: [{ ...accountRow, code: "PTY-00043", msme_number: "UDYAM-XX-00-0000001" }] };
      }
      if (sql.includes("FROM tenant.business_parties account")) {
        return { rows: [{ ...accountRow, code: "PTY-00043", msme_number: "UDYAM-XX-00-0000001" }] };
      }
      if (sql.includes("AS contacts") && sql.includes("AS opportunities")) {
        return { rows: [{ contacts: 0, opportunities: 0 }] };
      }
      return { rows: [] };
    },
  };
  await createCrmAccount(client, sensitiveViewerContext, {
    displayName: "Acme Manufacturing",
    msmeNumber: " UDYAM-XX-00-0000001 ",
  });
  const insert = calls.find((call) => call.sql.includes("INSERT INTO tenant.business_parties"));
  assert.match(insert.sql, /msme_number/);
  assert.equal(insert.values.includes("UDYAM-XX-00-0000001"), true, "the trimmed MSME number must actually be bound as an INSERT parameter");
});

function duplicateBlockingClient({ existingGstin = "27AABCU9603R1ZM" } = {}) {
  const calls = [];
  const inserted = [];
  return {
    calls,
    inserted,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("SELECT * FROM tenant.crm_duplicate_rules")) {
        return { rows: [{ signal: "gstin", method: "exact", weight: 70, fuzzy_threshold: null, enabled: true, blocking: true }] };
      }
      if (sql.includes("SELECT max(updated_at) AS at FROM tenant.crm_duplicate_rules")) {
        return { rows: [{ at: new Date("2026-01-01") }] };
      }
      if (sql.includes("SELECT DISTINCT unnest(matched_party_ids)")) {
        return { rows: [] };
      }
      if (/FROM tenant\.business_parties party\s/.test(sql)) {
        return {
          rows: [
            {
              id: "existing-account-1",
              display_name: "Acme Existing",
              match_score: 70,
              matched_signals: ["gstin"],
              classification: "exact",
            },
          ],
        };
      }
      if (sql.includes("UPDATE public.numbering_series")) {
        return { rows: [{ prefix: "PTY-", number: 99, padding: 5 }] };
      }
      if (sql.includes("INSERT INTO tenant.business_parties")) {
        return { rows: [{ ...accountRow, id: "new-account-1", gstin: existingGstin }] };
      }
      if (sql.includes("FROM tenant.business_parties account")) {
        return { rows: [{ ...accountRow, id: "new-account-1", gstin: existingGstin }] };
      }
      if (sql.includes("AS contacts") && sql.includes("AS opportunities")) {
        return { rows: [{ contacts: 0, opportunities: 0 }] };
      }
      if (sql.includes("INSERT INTO tenant.crm_account_duplicate_overrides")) {
        inserted.push(values);
        return { rows: [{ id: "override-1" }] };
      }
      return { rows: [] };
    },
  };
}

test("F002/F008: creating an Account that exactly matches an existing GSTIN is blocked without an override reason", async () => {
  const client = duplicateBlockingClient();
  await assert.rejects(
    () => createCrmAccount(client, sensitiveViewerContext, { displayName: "Acme New Entity", gstin: "27AABCU9603R1ZM" }),
    (error) => error.code === "CRM_ACCOUNT_DUPLICATE_EXACT" && error.status === 409,
  );
  assert.equal(client.calls.some((c) => c.sql.includes("INSERT INTO tenant.business_parties")), false, "the account must not be created while the exact duplicate is unresolved");
});

test("F002/F008: a caller without crm.accounts.manage cannot override an exact duplicate even with a reason", async () => {
  const client = duplicateBlockingClient();
  const noOverrideContext = { ...sensitiveViewerContext, permissions: ["crm.view", "parties.manage", "crm.accounts.view_sensitive"] };
  await assert.rejects(
    () =>
      createCrmAccount(client, noOverrideContext, {
        displayName: "Acme New Entity",
        gstin: "27AABCU9603R1ZM",
        duplicateOverrideReason: "This is a genuinely separate legal entity",
      }),
    (error) => error.code === "CRM_ACCOUNT_DUPLICATE_EXACT",
  );
});

test("F002/F008: an authorized caller with a valid reason may create the exact duplicate, and the override is recorded as immutable evidence", async () => {
  const client = duplicateBlockingClient();
  const overrideContext = {
    ...sensitiveViewerContext,
    permissions: ["crm.view", "parties.manage", "crm.accounts.view_sensitive", "crm.accounts.manage"],
  };
  await createCrmAccount(client, overrideContext, {
    displayName: "Acme New Entity",
    gstin: "27AABCU9603R1ZM",
    duplicateOverrideReason: "This is a genuinely separate legal entity, confirmed by phone",
  });
  assert.equal(client.inserted.length, 1);
  assert.equal(client.inserted[0][3], "create");
  assert.match(client.inserted[0][4], /genuinely separate legal entity/);
});

test("F002/F008: a merely probable (non-blocking) match does not require an override", async () => {
  const client = duplicateBlockingClient();
  client.query = async function (sql, values = []) {
    this.calls.push({ sql, values });
    if (sql.includes("SELECT * FROM tenant.crm_duplicate_rules")) {
      return { rows: [{ signal: "legal_name", method: "normalized", weight: 35, fuzzy_threshold: null, enabled: true, blocking: false }] };
    }
    if (/FROM tenant\.business_parties party\s/.test(sql)) {
      return { rows: [{ id: "existing-account-1", display_name: "Acme Existing", match_score: 35, matched_signals: ["legal_name"], classification: "probable" }] };
    }
    if (sql.includes("UPDATE public.numbering_series")) return { rows: [{ prefix: "PTY-", number: 99, padding: 5 }] };
    if (sql.includes("INSERT INTO tenant.business_parties")) return { rows: [{ ...accountRow, id: "new-account-1" }] };
    if (sql.includes("FROM tenant.business_parties account")) return { rows: [{ ...accountRow, id: "new-account-1" }] };
    if (sql.includes("AS contacts") && sql.includes("AS opportunities")) return { rows: [{ contacts: 0, opportunities: 0 }] };
    return { rows: [] };
  };
  const created = await createCrmAccount(client, context, { displayName: "Acme Existing Ltd" });
  assert.equal(created.id, "new-account-1");
});

test("F002: list search and filters remain organization and active-company scoped", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("count(*)::int AS count"))
        return { rows: [{ count: 1 }] };
      if (sql.includes("array_remove(array_agg")) {
        return { rows: [{ industries: ["Manufacturing"], countries: ["IN"] }] };
      }
      return { rows: [accountRow] };
    },
  };
  const result = await listCrmAccounts(client, context, {
    search: "Acme",
    status: "active",
    industry: "Manufacturing",
    country: "IN",
  });
  assert.equal(result.total, 1);
  assert.equal(result.rows[0].displayName, "Acme Manufacturing");
  assert.deepEqual(result.filters, {
    industries: ["Manufacturing"],
    countries: ["IN"],
    owners: [],
  });
  for (const call of calls) {
    assert.match(call.sql, /organization_id = \$1/);
  }
  assert.equal(
    calls.some((call) => call.values?.includes(context.activeCompanyId)),
    true,
  );
  assert.match(calls[0].sql, /to_tsvector/);
  assert.match(calls[0].sql, /account\.website/);
  assert.match(calls[0].sql, /tenant\.addresses search_address/);
});

function lifecycleClient() {
  const calls = [];
  let status = "active";
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.business_parties account")) {
        return { rows: [{ ...accountRow, status }] };
      }
      if (sql.includes("AS contacts") && sql.includes("AS opportunities")) {
        return { rows: [{ contacts: 5, opportunities: 3 }] };
      }
      if (
        sql.includes("UPDATE tenant.business_parties") &&
        sql.includes("archived_at = now()")
      ) {
        status = "inactive";
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

test("F002: partial updates preserve omitted persisted fields and emit an update event", async () => {
  const client = lifecycleClient();
  const updated = await updateCrmAccount(client, context, accountRow.id, {
    industry: "Industrial manufacturing",
  });
  assert.equal(updated.email, accountRow.email);
  const update = client.calls.find((call) =>
    call.sql.includes("UPDATE tenant.business_parties account"),
  );
  assert.ok(update);
  assert.match(update.sql, /industry = \$3/);
  assert.doesNotMatch(update.sql, /email =/);
  const outbox = client.calls.find((call) =>
    call.sql.includes("INSERT INTO tenant.crm_outbox_events"),
  );
  assert.equal(outbox.values[1], "crm.accounts.updated");
});

test("F002: archive is soft, preserves related rows and emits the governed event", async () => {
  const client = lifecycleClient();
  const archived = await archiveCrmAccount(client, context, accountRow.id);
  assert.equal(archived.status, "inactive");
  assert.deepEqual(archived.relationships, { contacts: 5, opportunities: 3 });
  assert.equal(
    client.calls.some((call) => /\bDELETE\b/i.test(call.sql)),
    false,
  );
  assert.equal(
    client.calls.some((call) => call.sql.includes("status = 'inactive'")),
    true,
  );
  const outbox = client.calls.find((call) =>
    call.sql.includes("INSERT INTO tenant.crm_outbox_events"),
  );
  assert.equal(outbox.values[1], "crm.accounts.archived");
});

test("F002: a scoped lookup cannot discover an account outside the active company", async () => {
  const client = {
    async query() {
      return { rows: [] };
    },
  };
  await assert.rejects(
    () =>
      updateCrmAccount(client, context, accountRow.id, { industry: "Other" }),
    (error) => error.code === "CRM_ACCOUNT_NOT_FOUND" && error.status === 404,
  );
});

test("F002: fabricated owner assignment is rejected server-side", async () => {
  const client = lifecycleClient();
  await assert.rejects(
    () =>
      updateCrmAccount(client, context, accountRow.id, {
        ownerUserId: "55555555-5555-4555-8555-555555555555",
      }),
    (error) =>
      error.code === "CRM_OWNER_ASSIGNMENT_FORBIDDEN" && error.status === 403,
  );
});

// --- CRM-VNEXT-004/035: Account sensitive-field (GSTIN/PAN/MSME) policy ---
// Real behavioral tests (not source-regex) proving the same server-side
// projection pattern already established for Leads (Prompt 1) and Contacts
// now also covers Accounts.

const sensitiveAccountRow = Object.freeze({
  ...accountRow,
  gstin: "27AAAAA0000A1Z5",
  pan: "AAAAA0000A",
  msme_number: "UDYAM-MH-01-0000001",
  // The GENERATED column added by migration
  // 091_f008_account_contact_matching_performance.sql — real `SELECT
  // party.*` queries always include this. A restricted browser E2E run
  // (erp-crm-sensitive-projection.spec.ts) found it leaking the PAN value
  // even when `pan` itself was correctly redacted.
  normalized_pan: "AAAAA0000A",
});

const ordinaryViewerContext = Object.freeze({
  ...context,
  permissions: ["crm.view", "parties.manage"],
  roleSlugs: [],
});
const sensitiveViewerContext = Object.freeze({
  ...context,
  permissions: ["crm.view", "parties.manage", "crm.accounts.view_sensitive"],
  roleSlugs: [],
});

function sensitiveAccountClient() {
  return {
    async query(sql) {
      if (sql.includes("FROM tenant.business_parties account")) {
        return { rows: [sensitiveAccountRow] };
      }
      if (sql.includes("count(*)::int AS count")) {
        return { rows: [{ count: 1 }] };
      }
      if (sql.includes("AS contacts") && sql.includes("AS opportunities")) {
        return { rows: [{ contacts: 0, opportunities: 0 }] };
      }
      if (sql.includes("array_remove(array_agg")) {
        return { rows: [{ industries: [], countries: [] }] };
      }
      return { rows: [] };
    },
  };
}

test("F002 sensitive fields: an ordinary account viewer (no crm.accounts.view_sensitive) does not receive GSTIN/PAN/MSME via getCrmAccountForCaller", async () => {
  const record = await getCrmAccountForCaller(
    sensitiveAccountClient(),
    ordinaryViewerContext,
    accountRow.id,
  );
  assert.equal(record.gstin, undefined);
  assert.equal(record.pan, undefined);
  assert.equal(record.msmeNumber, undefined);
  assert.equal(record.normalizedPan, undefined, "the GENERATED normalized_pan column must be redacted too — it derives directly from PAN (regression, see erp-crm-sensitive-projection.spec.ts)");
  assert.equal(record.sensitiveDataRestricted, true);
  assert.equal(record.displayName, accountRow.display_name, "ordinary fields remain visible");
});

test("F002 sensitive fields: an authorized viewer (crm.accounts.view_sensitive) receives the real GSTIN/PAN/MSME values", async () => {
  const record = await getCrmAccountForCaller(
    sensitiveAccountClient(),
    sensitiveViewerContext,
    accountRow.id,
  );
  assert.equal(record.gstin, "27AAAAA0000A1Z5");
  assert.equal(record.pan, "AAAAA0000A");
  assert.equal(record.msmeNumber, "UDYAM-MH-01-0000001");
  assert.equal(record.sensitiveDataRestricted, undefined);
});

test("F002 sensitive fields: listCrmAccounts redacts GSTIN/PAN/MSME for an ordinary viewer and includes them for an authorized viewer", async () => {
  const ordinary = await listCrmAccounts(sensitiveAccountClient(), ordinaryViewerContext, {});
  assert.equal(ordinary.rows[0].gstin, undefined);
  assert.equal(ordinary.rows[0].sensitiveDataRestricted, true);

  const privileged = await listCrmAccounts(sensitiveAccountClient(), sensitiveViewerContext, {});
  assert.equal(privileged.rows[0].gstin, "27AAAAA0000A1Z5");
});

test("F002 sensitive fields: an ordinary viewer cannot set GSTIN/PAN/MSME on create — blocked before any write query", async () => {
  const calls = [];
  const client = {
    async query(sql, values) {
      calls.push(sql);
      return { rows: [] };
    },
  };
  await assert.rejects(
    createCrmAccount(client, ordinaryViewerContext, {
      displayName: "Beta Industries",
      gstin: "27BBBBB1111B1Z5",
    }),
    (error) =>
      error.status === 403 &&
      error.code === "CRM_ACCOUNT_SENSITIVE_FIELD_FORBIDDEN",
  );
  assert.equal(calls.length, 0, "no write should be attempted once the sensitive-field guard rejects the input");
});

test("F002 sensitive fields: an ordinary viewer cannot change GSTIN/PAN/MSME on update, but may still edit ordinary fields", async () => {
  const client = lifecycleClient();
  await assert.rejects(
    updateCrmAccount(client, ordinaryViewerContext, accountRow.id, {
      pan: "ZZZZZ9999Z",
    }),
    (error) =>
      error.status === 403 &&
      error.code === "CRM_ACCOUNT_SENSITIVE_FIELD_FORBIDDEN",
  );

  await assert.doesNotReject(
    updateCrmAccount(client, ordinaryViewerContext, accountRow.id, {
      industry: "Logistics",
    }),
  );
  const update = client.calls.find((call) =>
    call.sql.includes("UPDATE tenant.business_parties account"),
  );
  assert.match(update.sql, /industry = /);
});

test("F002 sensitive fields: an authorized viewer may set GSTIN/PAN/MSME on update", async () => {
  const client = lifecycleClient();
  await assert.doesNotReject(
    updateCrmAccount(client, sensitiveViewerContext, accountRow.id, {
      gstin: "27CCCCC2222C1Z5",
    }),
  );
});
