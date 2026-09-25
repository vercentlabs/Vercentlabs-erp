import assert from "node:assert/strict";
import test from "node:test";

import {
  CrmAccountIntelligenceError,
  mergeAccountsGoverned,
  mergeContactsGoverned,
  previewAccountMerge,
  previewAccountMergeForCaller,
  previewContactMergeForCaller,
} from "../src/modules/crm/prospect-and-relationship-master-data/account-intelligence.js";

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const sourceAccountId = "33333333-3333-4333-8333-333333333333";
const survivorAccountId = "44444444-4444-4444-8444-444444444444";
const sourceContactId = "55555555-5555-4555-8555-555555555555";
const survivorContactId = "66666666-6666-4666-8666-666666666666";

function norm(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function context(overrides = {}) {
  return { organizationId: org, userId: user, permissions: [], roleSlugs: [], ...overrides };
}

function sensitiveContext() {
  return context({ permissions: ["crm.accounts.view_sensitive", "crm.contacts.view_sensitive"] });
}

// Builds a fake client covering the full mergeAccountsGoverned/
// mergeContactsGoverned/preview* query sequence, parameterized by the two
// candidate rows so tests can inject specific field-value conflicts.
function survivorshipClient({
  sourceAccount = {},
  survivorAccount = {},
  sourceContact = {},
  survivorContact = {},
  accountForeignKeys = [],
  contactForeignKeys = [],
} = {}) {
  const calls = [];
  const updates = [];
  const inserted = { accountMergeHistory: null, contactMergeHistory: null };
  const accounts = {
    [sourceAccountId]: { id: sourceAccountId, status: "active", updated_at: "2026-01-01T00:00:00.000Z", ...sourceAccount },
    [survivorAccountId]: { id: survivorAccountId, status: "active", updated_at: "2026-01-01T00:00:00.000Z", ...survivorAccount },
  };
  const contacts = {
    [sourceContactId]: { id: sourceContactId, status: "active", updated_at: "2026-01-01T00:00:00.000Z", ...sourceContact },
    [survivorContactId]: { id: survivorContactId, status: "active", updated_at: "2026-01-01T00:00:00.000Z", ...survivorContact },
  };
  return {
    calls,
    updates,
    inserted,
    async query(rawSql, params = []) {
      const sql = norm(rawSql);
      // Merge scope guard (restricted caller): no out-of-scope children here.
      if (/AS hidden$/.test(sql)) return { rows: [{ hidden: 0 }] };
      calls.push({ sql, params });

      if (/^SELECT id FROM tenant\.(business_parties|contacts) WHERE organization_id=\$1 AND id=ANY/.test(sql)) {
        return { rows: params[1].map((id) => ({ id })) };
      }
      if (/^SELECT party\.\*,parent\.display_name/.test(sql)) {
        const row = accounts[params[1]];
        return row ? { rows: [row] } : { rows: [] };
      }
      if (/^SELECT contact\.\*,party\.display_name/.test(sql)) {
        const row = contacts[params[1]];
        return row ? { rows: [row] } : { rows: [] };
      }
      if (/target\.relname=\$1/.test(sql)) {
        return { rows: params[0] === "business_parties" ? accountForeignKeys : contactForeignKeys };
      }
      if (/^SELECT count\(\*\)::int AS count FROM tenant\./.test(sql)) {
        return { rows: [{ count: 0 }] };
      }
      if (/^WITH RECURSIVE descendants AS/.test(sql)) {
        return { rows: [] };
      }
      if (/^UPDATE tenant\.business_parties SET .*updated_by=\$3,updated_at=now\(\) WHERE organization_id=\$1 AND id=\$2$/.test(sql)) {
        updates.push({ kind: "survivorship-account", sql, params });
        Object.assign(accounts[survivorAccountId], {});
        return { rows: [], rowCount: 1 };
      }
      if (/^UPDATE tenant\.contacts SET .*updated_by=\$3,updated_at=now\(\) WHERE organization_id=\$1 AND id=\$2$/.test(sql)) {
        updates.push({ kind: "survivorship-contact", sql, params });
        return { rows: [], rowCount: 1 };
      }
      if (/^UPDATE tenant\.contacts SET is_primary=false/.test(sql)) return { rows: [], rowCount: 0 };
      if (/^UPDATE tenant\.business_parties SET parent_party_id=/.test(sql)) return { rows: [] };
      if (/^UPDATE tenant\.crm_activities SET entity_id=/.test(sql)) return { rows: [], rowCount: 0 };
      if (/^UPDATE tenant\.crm_relationship_edges/.test(sql)) return { rows: [], rowCount: 0 };
      if (/^UPDATE tenant\.business_parties SET status='inactive'/.test(sql)) {
        updates.push({ kind: "deactivate-account", params });
        return { rows: [], rowCount: 1 };
      }
      if (/^UPDATE tenant\.contacts SET status='inactive'/.test(sql)) {
        updates.push({ kind: "deactivate-contact", params });
        return { rows: [], rowCount: 1 };
      }
      if (/^DELETE FROM tenant\.crm_contact_account_relationships/.test(sql)) return { rows: [] };
      if (/^UPDATE tenant\.crm_contact_account_relationships/.test(sql)) return { rows: [] };
      if (/^SELECT (1|id|party_id) FROM tenant\.crm_contact_account_relationships/.test(sql)) return { rows: [] };
      if (/^UPDATE tenant\.contacts SET party_id=\$3/.test(sql)) return { rows: [] };
      const repoint = sql.match(/^UPDATE tenant\."(\w+)" SET "(\w+)"=\$1 WHERE organization_id=\$2 AND "\2"=\$3$/);
      if (repoint) return { rows: [], rowCount: 0 };
      if (/^INSERT INTO tenant\.crm_account_merge_history/.test(sql)) {
        inserted.accountMergeHistory = params;
        return { rows: [{ id: "history-account-1" }] };
      }
      if (/^INSERT INTO tenant\.crm_contact_merge_history/.test(sql)) {
        inserted.contactMergeHistory = params;
        return { rows: [{ id: "history-contact-1" }] };
      }
      if (/^INSERT INTO tenant\.crm_entity_merge_aliases/.test(sql)) return { rows: [{ id: "alias-1" }] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F002/F003 survivorship: an unauthorized viewer's merge preview redacts sensitive fields and their values", async () => {
  const client = survivorshipClient({
    sourceAccount: { gstin: "27AAAAA0000A1Z5", display_name: "Acme Old" },
    survivorAccount: { gstin: "27BBBBB0000B1Z5", display_name: "Acme New" },
  });
  const preview = await previewAccountMergeForCaller(client, context(), sourceAccountId, survivorAccountId);
  assert.equal(preview.source.gstin, undefined);
  assert.equal(preview.survivor.gstin, undefined);
  assert.equal(preview.fieldComparison.some((f) => f.field === "gstin"), false, "a sensitive field must not appear in the comparison for an unauthorized viewer");
  assert.ok(preview.fieldComparison.some((f) => f.field === "display_name" && f.conflict === true));
});

test("F002/F003 survivorship: an authorized viewer's preview includes sensitive fields in the comparison", async () => {
  const client = survivorshipClient({
    sourceAccount: { gstin: "27AAAAA0000A1Z5" },
    survivorAccount: { gstin: "27BBBBB0000B1Z5" },
  });
  const preview = await previewAccountMergeForCaller(client, sensitiveContext(), sourceAccountId, survivorAccountId);
  assert.equal(preview.source.gstin, "27AAAAA0000A1Z5");
  const gstinField = preview.fieldComparison.find((f) => f.field === "gstin");
  assert.ok(gstinField);
  assert.equal(gstinField.conflict, true);
  assert.equal(gstinField.sensitive, true);
});

test("F002/F003 survivorship: an internal merge_history snapshot stays complete even when the acting user lacks sensitive view permission", async () => {
  const client = survivorshipClient({
    sourceAccount: { gstin: "27AAAAA0000A1Z5" },
    survivorAccount: { gstin: "27BBBBB0000B1Z5" },
  });
  await mergeAccountsGoverned(client, context(), sourceAccountId, survivorAccountId, "test");
  const snapshotSource = JSON.parse(client.inserted.accountMergeHistory[3]);
  assert.equal(snapshotSource.gstin, "27AAAAA0000A1Z5", "the permanent audit snapshot must retain the real value regardless of the merging user's own view permission");
});

test("F002 survivorship: selecting the source's value for a plain field updates the survivor row", async () => {
  const client = survivorshipClient({
    sourceAccount: { display_name: "Acme Original" },
    survivorAccount: { display_name: "Acme Duplicate" },
  });
  await mergeAccountsGoverned(client, context(), sourceAccountId, survivorAccountId, "test", {
    fieldSelections: { display_name: "source" },
  });
  const update = client.updates.find((u) => u.kind === "survivorship-account");
  assert.ok(update, "a survivorship UPDATE must run when a field selection changes the survivor's value");
  assert.ok(update.sql.includes('"display_name"'));
  assert.equal(update.params[3], "Acme Original");
});

test("F002 survivorship: selecting 'survivor' (no-op) issues no UPDATE but is still recorded in field_selections", async () => {
  const client = survivorshipClient({
    sourceAccount: { display_name: "Acme Original" },
    survivorAccount: { display_name: "Acme Duplicate" },
  });
  await mergeAccountsGoverned(client, context(), sourceAccountId, survivorAccountId, "test", {
    fieldSelections: { display_name: "survivor" },
  });
  assert.equal(client.updates.some((u) => u.kind === "survivorship-account"), false);
  const selections = JSON.parse(client.inserted.accountMergeHistory[7]);
  assert.equal(selections.display_name, "survivor");
});

test("F002 survivorship: a protected/non-selectable field is rejected before any write", async () => {
  const client = survivorshipClient({});
  await assert.rejects(
    () =>
      mergeAccountsGoverned(client, context(), sourceAccountId, survivorAccountId, "test", {
        fieldSelections: { status: "source" },
      }),
    (error) => error instanceof CrmAccountIntelligenceError && error.code === "CRM_MERGE_FIELD_NOT_SELECTABLE",
  );
  assert.equal(client.updates.length, 0);
});

test("F002 survivorship: an invalid selection value (not 'source'/'survivor') is rejected", async () => {
  const client = survivorshipClient({});
  await assert.rejects(
    () =>
      mergeAccountsGoverned(client, context(), sourceAccountId, survivorAccountId, "test", {
        fieldSelections: { display_name: "DROP TABLE business_parties" },
      }),
    (error) => error instanceof CrmAccountIntelligenceError && error.code === "CRM_MERGE_SELECTION_INVALID",
  );
});

test("F002 survivorship: selecting a sensitive field without crm.accounts.view_sensitive is rejected", async () => {
  const client = survivorshipClient({
    sourceAccount: { gstin: "27AAAAA0000A1Z5" },
    survivorAccount: { gstin: "27BBBBB0000B1Z5" },
  });
  await assert.rejects(
    () =>
      mergeAccountsGoverned(client, context(), sourceAccountId, survivorAccountId, "test", {
        fieldSelections: { gstin: "source" },
      }),
    (error) => error instanceof CrmAccountIntelligenceError && error.code === "CRM_MERGE_SENSITIVE_FIELD_FORBIDDEN",
  );
});

test("F002 survivorship: selecting a sensitive field WITH crm.accounts.view_sensitive is applied", async () => {
  const client = survivorshipClient({
    sourceAccount: { gstin: "27AAAAA0000A1Z5" },
    survivorAccount: { gstin: "27BBBBB0000B1Z5" },
  });
  await mergeAccountsGoverned(client, sensitiveContext(), sourceAccountId, survivorAccountId, "test", {
    fieldSelections: { gstin: "source" },
  });
  const update = client.updates.find((u) => u.kind === "survivorship-account");
  assert.ok(update);
  assert.equal(update.params[3], "27AAAAA0000A1Z5");
});

test("F002 survivorship: a stale comparison (record changed since preview was fetched) is rejected with a typed conflict, not applied", async () => {
  const client = survivorshipClient({
    survivorAccount: { updated_at: "2026-02-01T00:00:00.000Z" },
  });
  await assert.rejects(
    () =>
      mergeAccountsGoverned(client, context(), sourceAccountId, survivorAccountId, "test", {
        expectedSurvivorUpdatedAt: "2026-01-01T00:00:00.000Z",
      }),
    (error) => error instanceof CrmAccountIntelligenceError && error.code === "CRM_MERGE_COMPARISON_STALE" && error.status === 409,
  );
  assert.equal(client.updates.length, 0, "no side effect may occur once a stale comparison is detected");
});

test("F002 survivorship: a matching expectedUpdatedAt proceeds normally", async () => {
  const client = survivorshipClient({});
  const result = await mergeAccountsGoverned(client, context(), sourceAccountId, survivorAccountId, "test", {
    expectedSourceUpdatedAt: "2026-01-01T00:00:00.000Z",
    expectedSurvivorUpdatedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.ok(result.id);
});

test("F002 survivorship: a repeated merge attempt against an already-merged (inactive) source is rejected before any write", async () => {
  const client = survivorshipClient({
    sourceAccount: { status: "inactive" },
  });
  await assert.rejects(
    () => mergeAccountsGoverned(client, context(), sourceAccountId, survivorAccountId, "test"),
    (error) =>
      error instanceof CrmAccountIntelligenceError &&
      error.status === 409 &&
      /must be active/.test(error.message),
  );
  assert.equal(client.updates.length, 0, "an already-merged record must never be merged again");
});

test("F002 survivorship: concurrent merge safety — the account rows are row-locked (FOR UPDATE) before any status/staleness read, so a second concurrent attempt can only ever observe committed post-merge state, never a half-applied one", async () => {
  const client = survivorshipClient({});
  await mergeAccountsGoverned(client, context(), sourceAccountId, survivorAccountId, "test");
  const lockCall = client.calls.find(
    (c) => /FOR UPDATE$/.test(c.sql) && /business_parties/.test(c.sql),
  );
  assert.ok(lockCall, "the merge must acquire a row lock on both accounts before reading their state");
  // Simulate the second of two concurrent merge attempts against the same
  // pair: real Postgres would block this transaction on the FOR UPDATE
  // clause above until the first commits, then hand it the now-committed
  // (inactive) source row — reproduced here by re-running against a client
  // seeded with that post-commit state. It is rejected exactly like the
  // repeated-merge case, never silently double-applied.
  const secondAttemptClient = survivorshipClient({ sourceAccount: { status: "inactive" } });
  await assert.rejects(
    () => mergeAccountsGoverned(secondAttemptClient, context(), sourceAccountId, survivorAccountId, "test"),
    (error) => error instanceof CrmAccountIntelligenceError && error.status === 409,
  );
});

test("F002 survivorship: an error injected mid-merge propagates (is not swallowed) and no later step — deactivation, merge-history write — is ever reached; the caller's tenantTransaction() wraps this in one atomic transaction so a mid-merge throw rolls the whole attempt back", async () => {
  const client = survivorshipClient({});
  const rawQuery = client.query.bind(client);
  client.query = async (sql, params) => {
    if (/^UPDATE tenant\.crm_relationship_edges/.test(norm(sql))) {
      throw new Error("simulated mid-merge failure");
    }
    return rawQuery(sql, params);
  };
  await assert.rejects(
    () => mergeAccountsGoverned(client, context(), sourceAccountId, survivorAccountId, "test"),
    /simulated mid-merge failure/,
  );
  assert.equal(client.inserted.accountMergeHistory, null, "merge history must not be written once an earlier step has failed");
  assert.equal(
    client.updates.some((u) => u.kind === "deactivate-account"),
    false,
    "the loser account must not be deactivated once an earlier step has failed",
  );
});

// --- Contact survivorship ---

test("F003 survivorship: selecting the source's preferred language for a Contact updates the survivor row", async () => {
  const client = survivorshipClient({
    sourceContact: { preferred_language: "hi" },
    survivorContact: { preferred_language: "en" },
  });
  await mergeContactsGoverned(client, context(), sourceContactId, survivorContactId, "test", {
    fieldSelections: { preferred_language: "source" },
  });
  const update = client.updates.find((u) => u.kind === "survivorship-contact");
  assert.ok(update);
  assert.equal(update.params[3], "hi");
});

test("F003 survivorship: selecting a sensitive field (email) without permission is rejected", async () => {
  const client = survivorshipClient({
    sourceContact: { email: "a@example.com" },
    survivorContact: { email: "b@example.com" },
  });
  await assert.rejects(
    () =>
      mergeContactsGoverned(client, context(), sourceContactId, survivorContactId, "test", {
        fieldSelections: { email: "source" },
      }),
    (error) => error instanceof CrmAccountIntelligenceError && error.code === "CRM_MERGE_SENSITIVE_FIELD_FORBIDDEN",
  );
});

test("F003 survivorship: a Contact preview redacts email/mobile for an unauthorized viewer", async () => {
  const client = survivorshipClient({
    sourceContact: { email: "a@example.com" },
    survivorContact: { email: "b@example.com" },
  });
  const preview = await previewContactMergeForCaller(client, context(), sourceContactId, survivorContactId);
  assert.equal(preview.source.email, undefined);
  assert.equal(preview.fieldComparison.some((f) => f.field === "email"), false);
});

test("F003 survivorship: a standalone Contact (no linked Account) can be previewed and merged — regression, the internal contact() lookup previously used an INNER JOIN to business_parties and 404'd for any standalone Contact", async () => {
  const client = survivorshipClient({
    sourceContact: { party_id: null, account_name: null },
    survivorContact: { party_id: null, account_name: null },
  });
  const preview = await previewContactMergeForCaller(client, context(), sourceContactId, survivorContactId);
  assert.equal(preview.source.id, sourceContactId);
  const result = await mergeContactsGoverned(client, context(), sourceContactId, survivorContactId, "test");
  assert.ok(result.id);
});

test("F002/F003: previewAccountMerge (internal, raw) still exposes sensitive values regardless of caller permission — only the ...ForCaller wrapper redacts", async () => {
  const client = survivorshipClient({
    sourceAccount: { gstin: "27AAAAA0000A1Z5" },
  });
  const preview = await previewAccountMerge(client, context(), sourceAccountId, survivorAccountId);
  assert.equal(preview.source.gstin, "27AAAAA0000A1Z5");
});
