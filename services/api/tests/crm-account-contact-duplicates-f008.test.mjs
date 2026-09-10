import assert from "node:assert/strict";
import test from "node:test";

import {
  findAccountDuplicates,
  findContactDuplicates,
} from "../src/modules/crm/foundation.js";
import {
  CrmAccountIntelligenceError,
  mergeAccountsGoverned,
  mergeContactsGoverned,
} from "../src/modules/crm/account-intelligence.js";
import {
  dismissAccountDuplicateMatch,
  dismissContactDuplicateMatch,
  findLeadContactCrossMatches,
} from "../src/modules/crm/prospect-and-relationship-master-data/duplicate-matching.js";
import { CrmError } from "../src/modules/crm/index.js";

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const sourceAccountId = "33333333-3333-4333-8333-333333333333";
const survivorAccountId = "44444444-4444-4444-8444-444444444444";
const sourceContactId = "55555555-5555-4555-8555-555555555555";
const survivorContactId = "66666666-6666-4666-8666-666666666666";

function context(overrides = {}) {
  return { organizationId: org, userId: user, ...overrides };
}

function norm(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

// -----------------------------------------------------------------------
// findAccountDuplicates / findContactDuplicates
// (prospect-and-relationship-master-data/duplicate-matching.js, re-exported
// from foundation.js) — rule-driven since this prompt's continuation:
// getActiveDuplicateRules is queried first, then a dynamically-assembled
// (but always fixed-fragment, never free-text) query runs against it. The
// fake client below serves the seeded default rule set so real scoring
// logic executes; these tests verify (a) empty input never queries the
// database at all, (b) JS-side input normalization before binding, and (c)
// rows come back untouched.
// -----------------------------------------------------------------------

function defaultRuleRows(entityType) {
  const seeded = {
    account: [
      { signal: "gstin", method: "exact", weight: 70, fuzzy_threshold: null, enabled: true, blocking: true },
      { signal: "pan", method: "exact", weight: 45, fuzzy_threshold: null, enabled: true, blocking: false },
      { signal: "legal_name", method: "normalized", weight: 35, fuzzy_threshold: null, enabled: true, blocking: false },
    ],
    contact: [
      { signal: "email", method: "exact", weight: 70, fuzzy_threshold: null, enabled: true, blocking: true },
      { signal: "mobile", method: "normalized", weight: 55, fuzzy_threshold: null, enabled: true, blocking: true },
      { signal: "name", method: "normalized", weight: 30, fuzzy_threshold: null, enabled: true, blocking: false },
    ],
  };
  return seeded[entityType] || [];
}

function recordingClient(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const normalized = norm(sql);
      calls.push({ sql: normalized, params });
      if (/^SELECT \* FROM tenant\.crm_duplicate_rules/.test(normalized)) {
        return { rows: defaultRuleRows(params[1]) };
      }
      return { rows };
    },
    // The one query that actually touches business_parties/contacts —
    // convenience accessor so tests don't hardcode a calls[] index that
    // shifts whenever the rule-driven query's dynamic shape changes.
    dataCall() {
      return calls.find((c) => /FROM tenant\.(business_parties|contacts) /.test(c.sql));
    },
  };
}

test("F008 accounts: no name/gstin/pan short-circuits without querying the database", async () => {
  const db = recordingClient([{ id: "x" }]);
  const result = await findAccountDuplicates(db, context(), {});
  assert.deepEqual(result, []);
  assert.equal(db.dataCall(), undefined);
});

test("F008 accounts: gstin/pan are uppercased and name is normalized before binding", async () => {
  const db = recordingClient([]);
  await findAccountDuplicates(db, context(), {
    name: "Acme   Manufacturing Pvt. Ltd.",
    gstin: "  27aabcu9603r1zm ",
    pan: " aabcu9603r ",
    excludeId: survivorAccountId,
  });
  const call = db.dataCall();
  assert.ok(call, "the account matching query must run");
  assert.ok(call.params.includes("acmemanufacturingpvtltd"));
  assert.ok(call.params.includes("27AABCU9603R1ZM"));
  assert.ok(call.params.includes("AABCU9603R"));
  assert.ok(call.params.includes(survivorAccountId));
});

test("F008 accounts: matching rows are returned as provided by the query, annotated with a classification", async () => {
  const row = { id: "acc-1", display_name: "Acme", match_score: 70 };
  const db = recordingClient([row]);
  const result = await findAccountDuplicates(db, context(), { gstin: "27AABCU9603R1ZM" });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "acc-1");
  assert.equal(result[0].classification, "probable", "no matched_signals on the raw row, so it can't be classified 'exact'");
});

test("F008 accounts: a disabled rule never contributes to the query — no signal, no query at all when it's the only input provided", async () => {
  const db = recordingClient([]);
  db.query = async function (sql, params = []) {
    const normalized = norm(sql);
    this.calls.push({ sql: normalized, params });
    if (/^SELECT \* FROM tenant\.crm_duplicate_rules/.test(normalized)) {
      return { rows: [{ signal: "gstin", method: "exact", weight: 70, fuzzy_threshold: null, enabled: true, blocking: true }] };
    }
    return { rows: [] };
  };
  const result = await findAccountDuplicates(db, context(), { pan: "AABCU9603R" });
  assert.deepEqual(result, []);
  assert.equal(db.dataCall(), undefined, "pan has no enabled rule in this org, so no candidate query should run");
});

test("F008 contacts: no email/mobile/firstName short-circuits without querying the database", async () => {
  const db = recordingClient([{ id: "x" }]);
  const result = await findContactDuplicates(db, context(), { lastName: "Shah" });
  assert.deepEqual(result, []);
  assert.equal(db.dataCall(), undefined);
});

test("F008 contacts: email is lowercased and mobile keeps only the last 15 digits", async () => {
  const db = recordingClient([]);
  await findContactDuplicates(db, context(), {
    email: "  Priya@Example.COM ",
    mobile: "+91 99999-11111",
    excludeId: survivorContactId,
  });
  const call = db.dataCall();
  assert.ok(call, "the contact matching query must run");
  assert.ok(call.params.includes("priya@example.com"));
  assert.ok(call.params.includes("919999911111"));
  assert.ok(call.params.includes(survivorContactId));
});

test("F008 contacts: falls back to phone when mobile is absent", async () => {
  const db = recordingClient([]);
  await findContactDuplicates(db, context(), { phone: "022-4000-1234" });
  const call = db.dataCall();
  assert.ok(call.params.includes("02240001234"));
});

// -----------------------------------------------------------------------
// Classification (exact/blocking vs probable) and dismissal filtering with
// rule-change staleness — a candidate matched only on a blocking-rule
// signal is 'exact'; a dismissal only suppresses a candidate while the
// active rule set hasn't changed since the dismissal was recorded.
// -----------------------------------------------------------------------

function ruleAwareClient({ candidateRows, dismissalRows = [], rulesSnapshotAt = new Date("2026-01-01") } = {}) {
  const calls = [];
  return {
    calls,
    async query(rawSql, params = []) {
      const sql = norm(rawSql);
      calls.push({ sql, params });
      if (/^SELECT \* FROM tenant\.crm_duplicate_rules/.test(sql)) {
        return { rows: defaultRuleRows(params[1]) };
      }
      if (/^SELECT max\(updated_at\) AS at FROM tenant\.crm_duplicate_rules/.test(sql)) {
        return { rows: [{ at: rulesSnapshotAt }] };
      }
      if (/^SELECT DISTINCT unnest\(matched_party_ids\)/.test(sql) || /^SELECT DISTINCT unnest\(matched_contact_ids\)/.test(sql)) {
        return { rows: dismissalRows.map((id) => ({ candidate_id: id })) };
      }
      if (/FROM tenant\.(business_parties|contacts) /.test(sql)) {
        return { rows: candidateRows };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F008 accounts: a GSTIN-only match (blocking rule) classifies as 'exact'; a legal-name-only match (non-blocking rule) classifies as 'probable'", async () => {
  const exactRow = { id: "acc-exact", display_name: "Acme", match_score: 70, matched_signals: ["gstin"] };
  const probableRow = { id: "acc-probable", display_name: "Acme Ltd", match_score: 35, matched_signals: ["legal_name"] };
  const db = ruleAwareClient({ candidateRows: [exactRow, probableRow] });
  const result = await findAccountDuplicates(db, context(), { gstin: "27AABCU9603R1ZM" });
  assert.equal(result.find((r) => r.id === "acc-exact").classification, "exact");
  assert.equal(result.find((r) => r.id === "acc-probable").classification, "probable");
});

test("F008 accounts: a dismissed candidate is suppressed from future results while the rule set is unchanged", async () => {
  const row = { id: "acc-dismissed", display_name: "Acme", match_score: 70, matched_signals: ["gstin"] };
  const db = ruleAwareClient({
    candidateRows: [row],
    dismissalRows: ["acc-dismissed"],
    rulesSnapshotAt: new Date("2026-01-01"),
  });
  const result = await findAccountDuplicates(db, context(), { gstin: "27AABCU9603R1ZM", excludeId: sourceAccountId });
  assert.deepEqual(result, []);
});

test("F008 accounts: staleness is wired through activeRuleSetTimestamp — the dismissal query's threshold param is the current rule set's newest change, not a fixed/ignored value", async () => {
  const row = { id: "acc-dismissed", display_name: "Acme", match_score: 70, matched_signals: ["gstin"] };
  const asOf = new Date("2026-06-01T00:00:00.000Z");
  const db = ruleAwareClient({ candidateRows: [row], dismissalRows: ["acc-dismissed"], rulesSnapshotAt: asOf });
  await findAccountDuplicates(db, context(), { gstin: "27AABCU9603R1ZM", excludeId: sourceAccountId });
  const dismissalCall = db.calls.find((c) => c.sql.startsWith("SELECT DISTINCT unnest(matched_party_ids)"));
  assert.ok(dismissalCall, "the dismissal-suppression query must run once a candidate and a sourceId exist");
  assert.equal(dismissalCall.params[2], asOf, "the >= threshold must be the live activeRuleSetTimestamp() result, so an admin's later rule edit invalidates older dismissals");
});

test("F008 dismissal: requires at least one matched candidate id", async () => {
  const db = ruleAwareClient({ candidateRows: [] });
  await assert.rejects(
    () => dismissAccountDuplicateMatch(db, context(), sourceAccountId, [], "Confirmed different legal entities"),
    (error) => error instanceof CrmError && error.code === "CRM_DUPLICATE_DISMISS_EMPTY",
  );
});

test("F008 dismissal: requires a reason of at least 10 characters", async () => {
  const db = ruleAwareClient({ candidateRows: [] });
  await assert.rejects(
    () => dismissAccountDuplicateMatch(db, context(), sourceAccountId, [survivorAccountId], "too short"),
    (error) => error instanceof CrmError && error.code === "CRM_DUPLICATE_DISMISS_REASON_REQUIRED",
  );
});

test("F008 dismissal: a valid Contact dismissal records against the current active rule-set timestamp", async () => {
  let insertedParams = null;
  const db = ruleAwareClient({ candidateRows: [] });
  db.query = async (rawSql, params = []) => {
    const sql = norm(rawSql);
    db.calls.push({ sql, params });
    if (/^SELECT max\(updated_at\) AS at FROM tenant\.crm_duplicate_rules/.test(sql)) {
      return { rows: [{ at: new Date("2026-03-01") }] };
    }
    if (sql.startsWith("INSERT INTO tenant.crm_contact_duplicate_overrides")) {
      insertedParams = params;
      return { rows: [{ id: "override-1" }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  await dismissContactDuplicateMatch(db, context(), sourceContactId, [survivorContactId], "Verified different people on a call");
  assert.ok(insertedParams);
  assert.equal(insertedParams[1], sourceContactId);
  assert.deepEqual(insertedParams[2], [survivorContactId]);
  assert.equal(insertedParams[3], "dismiss");
  assert.equal(insertedParams[4], "Verified different people on a call");
});

// -----------------------------------------------------------------------
// findLeadContactCrossMatches (F008-CAP-002 cross-object matching) — a Lead
// can match an existing Contact on identity signals (email/mobile/name).
// -----------------------------------------------------------------------

test("F008 cross-object: no email/mobile/firstName short-circuits without querying the database", async () => {
  const db = recordingClient([]);
  const result = await findLeadContactCrossMatches(db, context(), { lastName: "Shah" });
  assert.deepEqual(result, []);
  assert.equal(db.dataCall(), undefined);
});

test("F008 cross-object: a Lead's email matches an existing Contact's normalized email", async () => {
  const db = recordingClient([]);
  db.query = async function (rawSql, params = []) {
    const sql = norm(rawSql);
    this.calls.push({ sql, params });
    if (/^SELECT \* FROM tenant\.crm_duplicate_rules/.test(sql)) {
      return { rows: defaultRuleRows("contact") };
    }
    if (/FROM tenant\.contacts contact/.test(sql)) {
      return { rows: [{ id: sourceContactId, first_name: "Priya", email: "priya@example.com" }] };
    }
    return { rows: [] };
  };
  const result = await findLeadContactCrossMatches(db, context(), { email: "priya@example.com" });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, sourceContactId);
});

// -----------------------------------------------------------------------
// mergeAccountsGoverned / mergeContactsGoverned (account-intelligence.js)
// — a small SQL-pattern-matching fake client, mirroring the style already
// used for Lead duplicate tests (crm-lead-duplicates-f008.test.mjs), sized
// to this function's real (multi-statement, transactional) query sequence.
// -----------------------------------------------------------------------

function mergeClient({
  accounts = {},
  contacts = {},
  accountForeignKeys = [],
  contactForeignKeys = [],
  descendantConflict = false,
} = {}) {
  const calls = [];
  const inserted = { accountMergeHistory: null, contactMergeHistory: null, aliases: [] };
  const updates = [];
  return {
    calls,
    inserted,
    updates,
    async query(rawSql, params = []) {
      const sql = norm(rawSql);
      calls.push({ sql, params });

      if (/^SELECT id FROM tenant\.business_parties WHERE organization_id=\$1 AND id=ANY/.test(sql)) {
        return { rows: params[1].map((id) => ({ id })) };
      }
      if (/^SELECT id FROM tenant\.contacts WHERE organization_id=\$1 AND id=ANY/.test(sql)) {
        return { rows: params[1].map((id) => ({ id })) };
      }
      if (/^SELECT party\.\*,parent\.display_name/.test(sql)) {
        const id = params[1];
        const row = accounts[id];
        if (!row) return { rows: [] };
        return { rows: [{ ...row, id }] };
      }
      if (/^SELECT contact\.\*,party\.display_name/.test(sql)) {
        const id = params[1];
        const row = contacts[id];
        if (!row) return { rows: [] };
        return { rows: [{ ...row, id }] };
      }
      if (/target\.relname=\$1/.test(sql)) {
        const targetTable = params[0];
        if (targetTable === "business_parties") return { rows: accountForeignKeys };
        if (targetTable === "contacts") return { rows: contactForeignKeys };
        return { rows: [] };
      }
      if (/^SELECT count\(\*\)::int AS count FROM tenant\./.test(sql)) {
        return { rows: [{ count: 0 }] };
      }
      if (/^WITH RECURSIVE descendants AS/.test(sql)) {
        return { rows: descendantConflict ? [{ "?column?": 1 }] : [] };
      }
      if (/^UPDATE tenant\.contacts SET is_primary=false/.test(sql)) {
        updates.push({ kind: "unset-primary", params });
        return { rows: [], rowCount: 0 };
      }
      if (/^UPDATE tenant\.business_parties SET parent_party_id=/.test(sql)) {
        updates.push({ kind: "reparent", params });
        return { rows: [] };
      }
      if (/^UPDATE tenant\.crm_activities SET entity_id=/.test(sql)) {
        updates.push({ kind: "activities", params });
        return { rows: [], rowCount: 0 };
      }
      if (/^UPDATE tenant\.crm_relationship_edges/.test(sql)) {
        updates.push({ kind: "relationship-edges", params });
        return { rows: [], rowCount: 0 };
      }
      if (/^UPDATE tenant\.business_parties SET status='inactive'/.test(sql)) {
        updates.push({ kind: "deactivate-account", params });
        return { rows: [], rowCount: 1 };
      }
      if (/^UPDATE tenant\.contacts SET status='inactive'/.test(sql)) {
        updates.push({ kind: "deactivate-contact", params });
        return { rows: [], rowCount: 1 };
      }
      // Relationship-reconciliation queries (contact-relationships.js) — no
      // relationship fixture rows are set up for these merge tests, so every
      // one of these is a legitimate no-op; asserting on them is F003's own
      // test file's job (crm-contact-account-relationships-f003.test.mjs).
      if (/^DELETE FROM tenant\.crm_contact_account_relationships/.test(sql)) {
        updates.push({ kind: "relationship-dedup-delete", params });
        return { rows: [], rowCount: 0 };
      }
      if (/^UPDATE tenant\.crm_contact_account_relationships SET party_id=\$3/.test(sql)) {
        updates.push({ kind: "relationship-repoint-account", params });
        return { rows: [], rowCount: 0 };
      }
      if (/^UPDATE tenant\.crm_contact_account_relationships SET contact_id=\$3/.test(sql)) {
        updates.push({ kind: "relationship-repoint-contact", params });
        return { rows: [], rowCount: 0 };
      }
      if (/^UPDATE tenant\.crm_contact_account_relationships SET is_primary=true/.test(sql)) {
        updates.push({ kind: "relationship-promote-primary", params });
        return { rows: [], rowCount: 0 };
      }
      if (/^SELECT (1|id) FROM tenant\.crm_contact_account_relationships/.test(sql)) {
        return { rows: [] };
      }
      if (/^SELECT party_id FROM tenant\.crm_contact_account_relationships/.test(sql)) {
        return { rows: [] };
      }
      if (/^UPDATE tenant\.contacts SET party_id=\$3/.test(sql)) {
        updates.push({ kind: "sync-primary-pointer", params });
        return { rows: [], rowCount: 0 };
      }
      // Generic repointReferences UPDATE: UPDATE tenant."<table>" SET "<col>"=$1 WHERE organization_id=$2 AND "<col>"=$3
      const repoint = sql.match(/^UPDATE tenant\."(\w+)" SET "(\w+)"=\$1 WHERE organization_id=\$2 AND "\2"=\$3$/);
      if (repoint) {
        updates.push({ kind: "repoint", table: repoint[1], column: repoint[2], params });
        return { rows: [], rowCount: 2 };
      }
      if (/^INSERT INTO tenant\.crm_account_merge_history/.test(sql)) {
        inserted.accountMergeHistory = { id: "merge-history-account-1", params };
        return { rows: [{ id: "merge-history-account-1" }] };
      }
      if (/^INSERT INTO tenant\.crm_contact_merge_history/.test(sql)) {
        inserted.contactMergeHistory = { id: "merge-history-contact-1", params };
        return { rows: [{ id: "merge-history-contact-1" }] };
      }
      if (/^INSERT INTO tenant\.crm_entity_merge_aliases/.test(sql)) {
        inserted.aliases.push(params);
        return { rows: [{ id: "alias-1" }] };
      }
      throw new Error(`Unexpected query in mergeClient: ${sql}`);
    },
  };
}

function activeAccount(overrides = {}) {
  return { organization_id: org, status: "active", display_name: "Account", ...overrides };
}
function activeContact(overrides = {}) {
  return { organization_id: org, status: "active", first_name: "Contact", ...overrides };
}

test("F008 account merge: merging an account into itself is rejected before any write", async () => {
  const db = mergeClient({});
  await assert.rejects(
    () => mergeAccountsGoverned(db, context(), sourceAccountId, sourceAccountId),
    (error) => {
      assert.ok(error instanceof CrmAccountIntelligenceError);
      assert.equal(error.status, 400);
      return true;
    },
  );
  assert.equal(db.calls.length, 0);
});

test("F008 account merge: both accounts must be active", async () => {
  const db = mergeClient({
    accounts: {
      [sourceAccountId]: activeAccount({ status: "inactive" }),
      [survivorAccountId]: activeAccount(),
    },
  });
  await assert.rejects(
    () => mergeAccountsGoverned(db, context(), sourceAccountId, survivorAccountId),
    (error) => {
      assert.ok(error instanceof CrmAccountIntelligenceError);
      assert.equal(error.status, 409);
      return true;
    },
  );
});

test("F008 account merge: merging a parent into its own descendant is rejected", async () => {
  const db = mergeClient({
    accounts: {
      [sourceAccountId]: activeAccount(),
      [survivorAccountId]: activeAccount(),
    },
    descendantConflict: true,
  });
  await assert.rejects(
    () => mergeAccountsGoverned(db, context(), sourceAccountId, survivorAccountId),
    (error) => {
      assert.ok(error instanceof CrmAccountIntelligenceError);
      assert.equal(error.code, "CRM_ACCOUNT_MERGE_DESCENDANT_CONFLICT");
      return true;
    },
  );
});

test("F008 account merge: happy path deactivates the source, repoints references and records a merge alias", async () => {
  const db = mergeClient({
    accounts: {
      [sourceAccountId]: activeAccount({ display_name: "Acme Old" }),
      [survivorAccountId]: activeAccount({ display_name: "Acme New" }),
    },
    accountForeignKeys: [{ table_name: "contacts", column_name: "party_id" }],
  });
  const result = await mergeAccountsGoverned(db, context(), sourceAccountId, survivorAccountId, "Duplicate entry");

  const deactivate = db.updates.find((u) => u.kind === "deactivate-account");
  assert.ok(deactivate, "source account must be deactivated");
  assert.equal(deactivate.params[2], sourceAccountId);

  const repoint = db.updates.find((u) => u.kind === "repoint" && u.table === "contacts");
  assert.ok(repoint, "contacts.party_id referencing the source must be repointed to the survivor");
  assert.equal(repoint.params[0], survivorAccountId);
  assert.equal(repoint.params[2], sourceAccountId);

  assert.ok(db.inserted.accountMergeHistory, "a crm_account_merge_history row must be recorded");
  assert.equal(db.inserted.aliases.length, 1);
  assert.equal(db.inserted.aliases[0][0], org);
  assert.equal(db.inserted.aliases[0][1], sourceAccountId);
  assert.equal(db.inserted.aliases[0][2], survivorAccountId);

  assert.equal(result.moved.length, 1);
  assert.equal(result.moved[0].tableName, "contacts");
});

test("F008 contact merge: merging a contact into itself is rejected before any write", async () => {
  const db = mergeClient({});
  await assert.rejects(
    () => mergeContactsGoverned(db, context(), sourceContactId, sourceContactId),
    (error) => {
      assert.ok(error instanceof CrmAccountIntelligenceError);
      assert.equal(error.status, 400);
      return true;
    },
  );
  assert.equal(db.calls.length, 0);
});

test("F008 contact merge: both contacts must be active", async () => {
  const db = mergeClient({
    contacts: {
      [sourceContactId]: activeContact({ status: "archived" }),
      [survivorContactId]: activeContact(),
    },
  });
  await assert.rejects(
    () => mergeContactsGoverned(db, context(), sourceContactId, survivorContactId),
    (error) => {
      assert.ok(error instanceof CrmAccountIntelligenceError);
      assert.equal(error.status, 409);
      return true;
    },
  );
});

test("F008 contact merge: happy path deactivates the source and records a merge alias", async () => {
  const db = mergeClient({
    contacts: {
      [sourceContactId]: activeContact({ first_name: "Priya" }),
      [survivorContactId]: activeContact({ first_name: "Priya" }),
    },
  });
  const result = await mergeContactsGoverned(db, context(), sourceContactId, survivorContactId, "Duplicate entry");

  const deactivate = db.updates.find((u) => u.kind === "deactivate-contact");
  assert.ok(deactivate, "source contact must be deactivated");
  assert.equal(deactivate.params[2], sourceContactId);

  assert.ok(db.inserted.contactMergeHistory, "a crm_contact_merge_history row must be recorded");
  assert.equal(db.inserted.aliases.length, 1);
  assert.equal(db.inserted.aliases[0][0], org);
  assert.equal(db.inserted.aliases[0][1], sourceContactId);
  assert.equal(db.inserted.aliases[0][2], survivorContactId);
  assert.deepEqual(result.moved, []);
});
