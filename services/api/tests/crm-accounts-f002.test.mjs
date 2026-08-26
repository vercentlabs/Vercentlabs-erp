import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAccountInput,
  validateAccountInput,
} from "../src/modules/crm/features/accounts/record-validation.js";
import {
  archiveCrmAccount,
  createCrmAccount,
  listCrmAccounts,
  updateCrmAccount,
} from "../src/modules/crm/account-operations.js";

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
      error.code === "CRM_ACCOUNT_OWNER_FORBIDDEN" && error.status === 403,
  );
});
