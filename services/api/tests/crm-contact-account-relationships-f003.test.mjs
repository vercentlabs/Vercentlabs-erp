import assert from "node:assert/strict";
import test from "node:test";

import {
  RELATIONSHIP_TYPES,
  STAKEHOLDER_ROLES,
  addContactAccountRelationship,
  listAccountContactRelationships,
  listContactAccountRelationships,
  removeContactAccountRelationship,
  setPrimaryContactAccountRelationship,
  updateContactAccountRelationship,
  ensurePrimaryRelationshipFromLegacyFields,
  reconcileRelationshipsOnContactMerge,
  reconcileRelationshipsOnAccountMerge,
} from "../src/modules/crm/prospect-and-relationship-master-data/contact-relationships.js";
import { CrmError } from "../src/modules/crm/index.js";

const org = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const contactId = "33333333-3333-4333-8333-333333333333";
const accountA = "44444444-4444-4444-8444-444444444444";
const accountB = "55555555-5555-4555-8555-555555555555";

function context(overrides = {}) {
  // Relationship ends are access-checked (crm-access-scope.js); this suite
  // exercises relationship rules, so it runs as a view-all, multi-company user.
  return { organizationId: org, userId: user, allowAllCompanies: true, permissions: ["crm.records.view_all"], roleSlugs: [], ...overrides };
}

function norm(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

function fakeClient({
  contactStatus = "active",
  accountStatus = { [accountA]: "active", [accountB]: "active" },
  existingRelationships = [],
} = {}) {
  const calls = [];
  const state = { relationships: [...existingRelationships] };
  return {
    calls,
    state,
    async query(rawSql, params = []) {
      const sql = norm(rawSql);
      calls.push({ sql, params });

      if (/^SELECT contact\.id, contact\.status FROM tenant\.contacts/.test(sql)) {
        return contactStatus ? { rows: [{ id: params[1], status: contactStatus }] } : { rows: [] };
      }
      if (/^SELECT account\.id FROM tenant\.business_parties account WHERE/.test(sql)) {
        return accountStatus[params[1]] ? { rows: [{ id: params[1] }] } : { rows: [] };
      }
      if (/^SELECT account\.id, account\.status FROM tenant\.business_parties/.test(sql)) {
        const status = accountStatus[params[1]];
        return status ? { rows: [{ id: params[1], status }] } : { rows: [] };
      }
      if (/^SELECT id FROM tenant\.crm_contact_account_relationships\s+WHERE organization_id=\$1 AND contact_id=\$2 AND party_id=\$3$/.test(sql)) {
        const [, cId, pId] = params;
        const found = state.relationships.find((r) => r.contact_id === cId && r.party_id === pId && r.status === "active");
        return { rows: found ? [{ id: found.id }] : [] };
      }
      if (/^SELECT 1 FROM tenant\.crm_contact_account_relationships\s+WHERE organization_id=\$1 AND contact_id=\$2 AND status='active' LIMIT 1$/.test(sql)) {
        const [, cId] = params;
        const found = state.relationships.some((r) => r.contact_id === cId && r.status === "active");
        return { rows: found ? [{}] : [] };
      }
      if (/^UPDATE tenant\.crm_contact_account_relationships\s+SET is_primary=false/.test(sql)) {
        const [, cId] = params;
        for (const r of state.relationships) {
          if (r.contact_id === cId) r.is_primary = false;
        }
        return { rows: [] };
      }
      if (/^INSERT INTO tenant\.crm_contact_account_relationships/.test(sql)) {
        const [, cId, pId, type, role, primary, notes] = params;
        const row = {
          id: `rel-${state.relationships.length + 1}`,
          contact_id: cId,
          party_id: pId,
          relationship_type: type,
          stakeholder_role: role,
          is_primary: primary,
          notes,
          status: "active",
        };
        state.relationships.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (/^SELECT rel\.\*, party\.display_name AS account_name/.test(sql)) {
        const [, cId] = params;
        return {
          rows: state.relationships
            .filter((r) => r.contact_id === cId && r.status === "active")
            .map((r) => ({ ...r, account_name: "Acme", account_status: "active" })),
        };
      }
      if (/^SELECT rel\.\*, contact\.first_name/.test(sql)) {
        const [, pId] = params;
        return {
          rows: state.relationships
            .filter((r) => r.party_id === pId && r.status === "active")
            .map((r) => ({ ...r, first_name: "Priya", last_name: "Shah", contact_status: "active" })),
        };
      }
      if (/^SELECT \* FROM tenant\.crm_contact_account_relationships\s+WHERE organization_id=\$1 AND id=\$2 AND contact_id=\$3/.test(sql)) {
        const [, id] = params;
        const found = state.relationships.find((r) => r.id === id);
        return { rows: found ? [found] : [] };
      }
      if (/^SELECT id FROM tenant\.crm_contact_account_relationships\s+WHERE organization_id=\$1 AND id=\$2 AND contact_id=\$3 AND status='active'$/.test(sql)) {
        const [, id] = params;
        const found = state.relationships.find((r) => r.id === id && r.status === "active");
        return { rows: found ? [{ id }] : [] };
      }
      if (/^UPDATE tenant\.crm_contact_account_relationships\s+SET is_primary=\(id=\$3\)/.test(sql)) {
        const [, cId, targetId] = params;
        for (const r of state.relationships) {
          if (r.contact_id === cId && r.status === "active") r.is_primary = r.id === targetId;
        }
        return { rows: [] };
      }
      if (/^UPDATE tenant\.crm_contact_account_relationships\s+SET status='inactive', is_primary=false/.test(sql)) {
        const [, id] = params;
        const found = state.relationships.find((r) => r.id === id);
        if (found) {
          found.status = "inactive";
          found.is_primary = false;
        }
        return { rows: [] };
      }
      if (/^UPDATE tenant\.crm_contact_account_relationships\s+SET status='inactive', updated_by/.test(sql)) {
        const [, id] = params;
        const found = state.relationships.find((r) => r.id === id);
        if (found) found.status = "inactive";
        return { rows: [] };
      }
      if (/^UPDATE tenant\.crm_contact_account_relationships\s+SET relationship_type=\$3/.test(sql)) {
        const [, id, type, role, notes] = params;
        const found = state.relationships.find((r) => r.id === id);
        if (found) {
          found.relationship_type = type;
          found.stakeholder_role = role;
          found.notes = notes;
        }
        return { rows: [] };
      }
      if (/^SELECT party_id FROM tenant\.crm_contact_account_relationships/.test(sql)) {
        const [, cId] = params;
        const primary = state.relationships.find((r) => r.contact_id === cId && r.is_primary && r.status === "active");
        return { rows: primary ? [{ party_id: primary.party_id }] : [] };
      }
      if (/^UPDATE tenant\.contacts SET party_id=\$3/.test(sql)) {
        return { rows: [] };
      }
      if (/^UPDATE tenant\.crm_contact_account_relationships\s+SET is_primary = CASE/.test(sql)) {
        // ON CONFLICT DO UPDATE branch of ensurePrimaryRelationshipFromLegacyFields — handled below
        return { rows: [] };
      }
      if (/^INSERT INTO tenant\.crm_outbox_events/.test(sql) || sql.includes("INSERT INTO tenant.crm_outbox_events")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F003 relationships: RELATIONSHIP_TYPES and STAKEHOLDER_ROLES are the fixed, non-empty vocabularies", () => {
  assert.ok(RELATIONSHIP_TYPES.length >= 2);
  assert.ok(STAKEHOLDER_ROLES.includes("economic_buyer"));
  assert.ok(STAKEHOLDER_ROLES.includes("champion"));
});

test("F003 relationships: adding a second Account relationship does not disturb the first, and the second is not auto-primary", async () => {
  const client = fakeClient();
  await addContactAccountRelationship(client, context(), contactId, {
    accountId: accountA,
    stakeholderRole: "champion",
  });
  const result = await addContactAccountRelationship(client, context(), contactId, {
    accountId: accountB,
    stakeholderRole: "economic_buyer",
  });
  assert.equal(result.length, 2);
  const primary = result.find((r) => r.isPrimary);
  assert.equal(primary.partyId, accountA, "the first relationship added remains primary");
  const second = result.find((r) => r.partyId === accountB);
  assert.equal(second.isPrimary, false);
  assert.equal(second.stakeholderRole, "economic_buyer");
});

test("F003 relationships: adding a duplicate (same Contact, same Account) relationship is rejected", async () => {
  const client = fakeClient({
    existingRelationships: [
      { id: "77777777-7777-4777-8777-777777777777", contact_id: contactId, party_id: accountA, relationship_type: "employment", is_primary: true, status: "active" },
    ],
  });
  await assert.rejects(
    () => addContactAccountRelationship(client, context(), contactId, { accountId: accountA }),
    (error) => error instanceof CrmError && error.code === "CRM_RELATIONSHIP_ALREADY_EXISTS",
  );
});

test("F003 relationships: an invalid stakeholder role is rejected before any write", async () => {
  const client = fakeClient();
  await assert.rejects(
    () => addContactAccountRelationship(client, context(), contactId, { accountId: accountA, stakeholderRole: "ceo" }),
    (error) => error instanceof CrmError && error.code === "CRM_STAKEHOLDER_ROLE_INVALID",
  );
  assert.equal(client.calls.some((c) => c.sql.startsWith("INSERT INTO tenant.crm_contact_account_relationships")), false);
});

test("F003 relationships: linking to an archived Account is rejected", async () => {
  const client = fakeClient({ accountStatus: { [accountA]: "inactive" } });
  await assert.rejects(
    () => addContactAccountRelationship(client, context(), contactId, { accountId: accountA }),
    (error) => error instanceof CrmError && error.code === "CRM_RELATIONSHIP_ACCOUNT_ARCHIVED",
  );
});

test("F003 relationships: setPrimaryContactAccountRelationship swaps which relationship is primary and syncs the legacy pointer", async () => {
  const client = fakeClient({
    existingRelationships: [
      { id: "77777777-7777-4777-8777-777777777777", contact_id: contactId, party_id: accountA, relationship_type: "employment", is_primary: true, status: "active" },
      { id: "88888888-8888-4888-8888-888888888888", contact_id: contactId, party_id: accountB, relationship_type: "affiliated", is_primary: false, status: "active" },
    ],
  });
  const result = await setPrimaryContactAccountRelationship(client, context(), contactId, "88888888-8888-4888-8888-888888888888");
  const primary = result.find((r) => r.isPrimary);
  assert.equal(primary.id, "88888888-8888-4888-8888-888888888888");
  assert.ok(client.calls.some((c) => c.sql.startsWith("UPDATE tenant.contacts SET party_id=$3")), "the legacy contacts.party_id pointer must be re-synced");
});

test("F003 relationships: removing the primary relationship without a replacement leaves the Contact standalone (party_id cleared)", async () => {
  const client = fakeClient({
    existingRelationships: [
      { id: "77777777-7777-4777-8777-777777777777", contact_id: contactId, party_id: accountA, relationship_type: "employment", is_primary: true, status: "active" },
    ],
  });
  const result = await removeContactAccountRelationship(client, context(), contactId, "77777777-7777-4777-8777-777777777777", {});
  assert.equal(result.length, 0);
  const syncCall = client.calls.find((c) => c.sql.startsWith("UPDATE tenant.contacts SET party_id=$3"));
  assert.ok(syncCall);
  assert.equal(syncCall.params[2], null, "with no relationships left, the synced pointer must be null");
});

test("F003 relationships: removing the primary WITH a promoteRelationshipId keeps exactly one primary", async () => {
  const client = fakeClient({
    existingRelationships: [
      { id: "77777777-7777-4777-8777-777777777777", contact_id: contactId, party_id: accountA, relationship_type: "employment", is_primary: true, status: "active" },
      { id: "88888888-8888-4888-8888-888888888888", contact_id: contactId, party_id: accountB, relationship_type: "affiliated", is_primary: false, status: "active" },
    ],
  });
  const result = await removeContactAccountRelationship(client, context(), contactId, "77777777-7777-4777-8777-777777777777", {
    promoteRelationshipId: "88888888-8888-4888-8888-888888888888",
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "88888888-8888-4888-8888-888888888888");
  assert.equal(result[0].isPrimary, true);
});

test("F003 relationships: updating role/notes never silently changes which relationship is primary unless isPrimary is explicitly true", async () => {
  const client = fakeClient({
    existingRelationships: [
      { id: "77777777-7777-4777-8777-777777777777", contact_id: contactId, party_id: accountA, relationship_type: "employment", is_primary: true, status: "active" },
    ],
  });
  const result = await updateContactAccountRelationship(client, context(), contactId, "77777777-7777-4777-8777-777777777777", {
    stakeholderRole: "legal",
    notes: "Handles contracts",
  });
  assert.equal(result[0].stakeholderRole, "legal");
  assert.equal(result[0].isPrimary, true);
});

test("F003 relationships: ensurePrimaryRelationshipFromLegacyFields is a no-op when accountId is empty", async () => {
  const client = fakeClient();
  await ensurePrimaryRelationshipFromLegacyFields(client, context(), contactId, null, false);
  assert.equal(client.calls.length, 0);
});

test("F003 relationships: reconcileRelationshipsOnContactMerge deletes the source's redundant row when the survivor already relates to the same Account (no unique-constraint collision)", async () => {
  const client = fakeClient();
  let deleteRan = false;
  let updateRan = false;
  client.query = async (rawSql, params = []) => {
    const sql = norm(rawSql);
    client.calls.push({ sql, params });
    if (sql.startsWith("DELETE FROM tenant.crm_contact_account_relationships")) {
      deleteRan = true;
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE tenant.crm_contact_account_relationships") && sql.includes("SET contact_id=$3")) {
      updateRan = true;
      return { rows: [] };
    }
    if (sql.startsWith("SELECT 1 FROM tenant.crm_contact_account_relationships")) return { rows: [{}] };
    if (sql.startsWith("SELECT party_id FROM tenant.crm_contact_account_relationships")) return { rows: [] };
    if (sql.startsWith("UPDATE tenant.contacts SET party_id=$3")) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  await reconcileRelationshipsOnContactMerge(client, context(), contactId, accountA);
  assert.ok(deleteRan, "overlapping relationships must be deduplicated via DELETE before the generic repoint runs");
  assert.ok(updateRan, "non-overlapping relationships must still be repointed onto the survivor");
});

test("F003 relationships: reconcileRelationshipsOnAccountMerge repoints and resyncs every affected Contact's primary pointer", async () => {
  const client = fakeClient();
  const repointedContacts = [contactId];
  const syncedContacts = [];
  client.query = async (rawSql, params = []) => {
    const sql = norm(rawSql);
    client.calls.push({ sql, params });
    if (sql.startsWith("DELETE FROM tenant.crm_contact_account_relationships")) return { rows: [] };
    if (sql.startsWith("UPDATE tenant.crm_contact_account_relationships") && sql.includes("SET party_id=$3")) {
      return { rows: repointedContacts.map((id) => ({ contact_id: id })) };
    }
    if (sql.startsWith("SELECT party_id FROM tenant.crm_contact_account_relationships")) return { rows: [] };
    if (sql.startsWith("UPDATE tenant.contacts SET party_id=$3")) {
      syncedContacts.push(params[1]);
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  await reconcileRelationshipsOnAccountMerge(client, context(), accountA, accountB);
  assert.deepEqual(syncedContacts, [contactId]);
});
