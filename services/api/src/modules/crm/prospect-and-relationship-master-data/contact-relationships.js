// F003 governed Contact<->Account relationship model (CRM vNext Prompt 3
// continuation, CRM-VNEXT-081). See migration
// 088_f003_contact_account_relationships.sql for the schema design
// rationale (relationship_type vs stakeholder_role, is_primary semantics
// distinct from contacts.is_primary, no effective-dating).
import { CrmError } from "../crm-data-operations-and-customization/errors.js";
import { queueOutboxEvent } from "../crm-data-operations-and-customization/outbox.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const RELATIONSHIP_TYPES = Object.freeze([
  "employment",
  "affiliated",
  "other",
]);

// Same vocabulary as tenant.crm_account_stakeholders.stakeholder_role — a
// deliberate consistency choice (same business concept, same words), NOT a
// reuse of that table (which is account-plan-scoped, a different feature).
export const STAKEHOLDER_ROLES = Object.freeze([
  "economic_buyer",
  "decision_maker",
  "champion",
  "influencer",
  "user",
  "blocker",
  "procurement",
  "legal",
  "technical",
  "other",
]);

function assertId(value, label) {
  if (!UUID_PATTERN.test(String(value || ""))) {
    throw new CrmError(400, `${label} identifier is invalid.`, "CRM_IDENTIFIER_INVALID");
  }
  return String(value);
}

function camelize(value) {
  return value.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
}

function dto(row) {
  return Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [camelize(key), value]),
  );
}

async function assertActiveAccount(client, context, partyId) {
  const result = await client.query(
    `SELECT id, status FROM tenant.business_parties WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, partyId],
  );
  if (!result.rows[0]) {
    throw new CrmError(404, "Account not found.", "CRM_ACCOUNT_NOT_FOUND");
  }
  if (result.rows[0].status !== "active") {
    throw new CrmError(
      409,
      "The Account must be active to add or change a relationship.",
      "CRM_RELATIONSHIP_ACCOUNT_ARCHIVED",
    );
  }
}

async function assertActiveContact(client, context, contactId) {
  const result = await client.query(
    `SELECT id, status FROM tenant.contacts WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, contactId],
  );
  if (!result.rows[0]) {
    throw new CrmError(404, "Contact not found.", "CRM_CONTACT_NOT_FOUND");
  }
  return result.rows[0];
}

function assertRelationshipInput(input) {
  const type = input.relationshipType ?? "employment";
  if (!RELATIONSHIP_TYPES.includes(type)) {
    throw new CrmError(
      400,
      "Choose a valid relationship type.",
      "CRM_RELATIONSHIP_TYPE_INVALID",
      { errors: { relationshipType: ["Choose a valid relationship type."] } },
    );
  }
  if (
    input.stakeholderRole != null &&
    input.stakeholderRole !== "" &&
    !STAKEHOLDER_ROLES.includes(input.stakeholderRole)
  ) {
    throw new CrmError(
      400,
      "Choose a valid stakeholder role.",
      "CRM_STAKEHOLDER_ROLE_INVALID",
      { errors: { stakeholderRole: ["Choose a valid stakeholder role."] } },
    );
  }
  return {
    relationshipType: type,
    stakeholderRole: input.stakeholderRole || null,
    notes: input.notes ? String(input.notes).trim().slice(0, 2000) : null,
  };
}

// Keeps contacts.party_id/is_primary (the fast, backward-compatible primary
// pointer every pre-existing caller reads) mirrored to whichever
// relationship row is is_primary=true. Called both from the new relationship
// endpoints AND from contact-operations.js's create/update (the legacy
// accountId/isPrimary path), so either entry point keeps both models
// consistent — no caller can desync them.
export async function syncPrimaryContactPointer(client, context, contactId) {
  const primary = await client.query(
    `SELECT party_id FROM tenant.crm_contact_account_relationships
     WHERE organization_id=$1 AND contact_id=$2 AND is_primary=true AND status='active'
     LIMIT 1`,
    [context.organizationId, contactId],
  );
  await client.query(
    `UPDATE tenant.contacts SET party_id=$3, updated_at=now()
     WHERE organization_id=$1 AND id=$2 AND party_id IS DISTINCT FROM $3`,
    [context.organizationId, contactId, primary.rows[0]?.party_id ?? null],
  );
}

// Called from contact-operations.js whenever the legacy accountId/isPrimary
// fields are touched (create or update), so the relationship table stays
// authoritative even for callers who only know about the old single-Account
// model. Idempotent — safe to call on every create/update regardless of
// whether accountId actually changed.
export async function ensurePrimaryRelationshipFromLegacyFields(
  client,
  context,
  contactId,
  accountId,
  isPrimary,
) {
  if (!accountId) return;
  if (isPrimary) {
    await client.query(
      `UPDATE tenant.crm_contact_account_relationships
       SET is_primary=false, updated_by=$4, updated_at=now()
       WHERE organization_id=$1 AND contact_id=$2 AND party_id<>$3 AND is_primary=true AND status='active'`,
      [context.organizationId, contactId, accountId, context.userId],
    );
  }
  await client.query(
    `INSERT INTO tenant.crm_contact_account_relationships
       (organization_id, contact_id, party_id, relationship_type, is_primary, status, created_by, updated_by)
     VALUES ($1,$2,$3,'employment',$4,'active',$5,$5)
     ON CONFLICT (organization_id, contact_id, party_id)
     DO UPDATE SET
       is_primary = CASE WHEN $4 THEN true ELSE crm_contact_account_relationships.is_primary END,
       status = 'active',
       updated_by = $5,
       updated_at = now()`,
    [context.organizationId, contactId, accountId, Boolean(isPrimary), context.userId],
  );
}

// Called from contact-operations.js when the legacy accountId field is
// explicitly cleared (unlink). Mirrors "Account unlink is explicit" — the
// relationship row is not deleted, only demoted from primary, so relationship
// history/role/notes survive the unlink exactly like every other Contact
// field change does.
export async function clearPrimaryRelationshipFromLegacyFields(client, context, contactId) {
  await client.query(
    `UPDATE tenant.crm_contact_account_relationships
     SET is_primary=false, updated_by=$3, updated_at=now()
     WHERE organization_id=$1 AND contact_id=$2 AND is_primary=true AND status='active'`,
    [context.organizationId, contactId, context.userId],
  );
}

export async function listContactAccountRelationships(client, context, contactId) {
  assertId(contactId, "Contact");
  await assertActiveContact(client, context, contactId);
  const result = await client.query(
    `SELECT rel.*, party.display_name AS account_name, party.status AS account_status
     FROM tenant.crm_contact_account_relationships rel
     JOIN tenant.business_parties party
       ON party.organization_id = rel.organization_id AND party.id = rel.party_id
     WHERE rel.organization_id=$1 AND rel.contact_id=$2 AND rel.status='active'
     ORDER BY rel.is_primary DESC, party.display_name`,
    [context.organizationId, contactId],
  );
  return result.rows.map(dto);
}

export async function listAccountContactRelationships(client, context, partyId) {
  assertId(partyId, "Account");
  const result = await client.query(
    `SELECT rel.*, contact.first_name, contact.last_name, contact.designation, contact.status AS contact_status
     FROM tenant.crm_contact_account_relationships rel
     JOIN tenant.contacts contact
       ON contact.organization_id = rel.organization_id AND contact.id = rel.contact_id
     WHERE rel.organization_id=$1 AND rel.party_id=$2 AND rel.status='active'
     ORDER BY rel.is_primary DESC, contact.first_name, contact.last_name`,
    [context.organizationId, partyId],
  );
  return result.rows.map(dto);
}

export async function addContactAccountRelationship(client, context, contactId, input = {}) {
  assertId(contactId, "Contact");
  const accountId = assertId(input.accountId, "Account");
  await assertActiveContact(client, context, contactId);
  await assertActiveAccount(client, context, accountId);
  const normalized = assertRelationshipInput(input);
  const existing = await client.query(
    `SELECT id FROM tenant.crm_contact_account_relationships
     WHERE organization_id=$1 AND contact_id=$2 AND party_id=$3`,
    [context.organizationId, contactId, accountId],
  );
  if (existing.rows[0]) {
    throw new CrmError(
      409,
      "This Contact already has a relationship with that Account.",
      "CRM_RELATIONSHIP_ALREADY_EXISTS",
    );
  }
  const isFirst = await client.query(
    `SELECT 1 FROM tenant.crm_contact_account_relationships
     WHERE organization_id=$1 AND contact_id=$2 AND status='active' LIMIT 1`,
    [context.organizationId, contactId],
  );
  const isPrimary = Boolean(input.isPrimary) || !isFirst.rows[0];
  if (isPrimary) {
    await client.query(
      `UPDATE tenant.crm_contact_account_relationships
       SET is_primary=false, updated_by=$3, updated_at=now()
       WHERE organization_id=$1 AND contact_id=$2 AND is_primary=true AND status='active'`,
      [context.organizationId, contactId, context.userId],
    );
  }
  const inserted = await client.query(
    `INSERT INTO tenant.crm_contact_account_relationships
       (organization_id, contact_id, party_id, relationship_type, stakeholder_role, is_primary, notes, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
     RETURNING id`,
    [
      context.organizationId,
      contactId,
      accountId,
      normalized.relationshipType,
      normalized.stakeholderRole,
      isPrimary,
      normalized.notes,
      context.userId,
    ],
  );
  await syncPrimaryContactPointer(client, context, contactId);
  await queueOutboxEvent(
    client,
    context,
    "crm.contact_relationships.added",
    "contact",
    contactId,
    { contactId, accountId, isPrimary },
  );
  return listContactAccountRelationships(client, context, contactId);
}

export async function updateContactAccountRelationship(
  client,
  context,
  contactId,
  relationshipId,
  input = {},
) {
  assertId(contactId, "Contact");
  assertId(relationshipId, "Relationship");
  await assertActiveContact(client, context, contactId);
  const existing = await client.query(
    `SELECT * FROM tenant.crm_contact_account_relationships
     WHERE organization_id=$1 AND id=$2 AND contact_id=$3`,
    [context.organizationId, relationshipId, contactId],
  );
  if (!existing.rows[0]) {
    throw new CrmError(404, "Relationship not found.", "CRM_RELATIONSHIP_NOT_FOUND");
  }
  const normalized = assertRelationshipInput({
    relationshipType: input.relationshipType ?? existing.rows[0].relationship_type,
    stakeholderRole:
      input.stakeholderRole === undefined ? existing.rows[0].stakeholder_role : input.stakeholderRole,
    notes: input.notes === undefined ? existing.rows[0].notes : input.notes,
  });
  await client.query(
    `UPDATE tenant.crm_contact_account_relationships
     SET relationship_type=$3, stakeholder_role=$4, notes=$5, updated_by=$6, updated_at=now()
     WHERE organization_id=$1 AND id=$2`,
    [
      context.organizationId,
      relationshipId,
      normalized.relationshipType,
      normalized.stakeholderRole,
      normalized.notes,
      context.userId,
    ],
  );
  if (input.isPrimary === true && !existing.rows[0].is_primary) {
    await setPrimaryContactAccountRelationship(client, context, contactId, relationshipId);
  }
  return listContactAccountRelationships(client, context, contactId);
}

export async function setPrimaryContactAccountRelationship(
  client,
  context,
  contactId,
  relationshipId,
) {
  assertId(contactId, "Contact");
  assertId(relationshipId, "Relationship");
  const target = await client.query(
    `SELECT id FROM tenant.crm_contact_account_relationships
     WHERE organization_id=$1 AND id=$2 AND contact_id=$3 AND status='active'`,
    [context.organizationId, relationshipId, contactId],
  );
  if (!target.rows[0]) {
    throw new CrmError(404, "Relationship not found.", "CRM_RELATIONSHIP_NOT_FOUND");
  }
  await client.query(
    `UPDATE tenant.crm_contact_account_relationships
     SET is_primary=(id=$3), updated_by=$4, updated_at=now()
     WHERE organization_id=$1 AND contact_id=$2 AND status='active'`,
    [context.organizationId, contactId, relationshipId, context.userId],
  );
  await syncPrimaryContactPointer(client, context, contactId);
  return listContactAccountRelationships(client, context, contactId);
}

export async function removeContactAccountRelationship(
  client,
  context,
  contactId,
  relationshipId,
  options = {},
) {
  assertId(contactId, "Contact");
  assertId(relationshipId, "Relationship");
  const existing = await client.query(
    `SELECT * FROM tenant.crm_contact_account_relationships
     WHERE organization_id=$1 AND id=$2 AND contact_id=$3 AND status='active'`,
    [context.organizationId, relationshipId, contactId],
  );
  if (!existing.rows[0]) {
    throw new CrmError(404, "Relationship not found.", "CRM_RELATIONSHIP_NOT_FOUND");
  }
  if (existing.rows[0].is_primary) {
    const promoteId = options.promoteRelationshipId
      ? assertId(options.promoteRelationshipId, "Relationship")
      : null;
    if (promoteId) {
      await client.query(
        `UPDATE tenant.crm_contact_account_relationships
         SET status='inactive', is_primary=false, updated_by=$3, updated_at=now()
         WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, relationshipId, context.userId],
      );
      await setPrimaryContactAccountRelationship(client, context, contactId, promoteId);
      return listContactAccountRelationships(client, context, contactId);
    }
    // No replacement chosen: the Contact becomes standalone, exactly as the
    // existing "Account unlink is explicit" contract already allows.
    await client.query(
      `UPDATE tenant.crm_contact_account_relationships
       SET status='inactive', is_primary=false, updated_by=$3, updated_at=now()
       WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, relationshipId, context.userId],
    );
    await syncPrimaryContactPointer(client, context, contactId);
    return listContactAccountRelationships(client, context, contactId);
  }
  await client.query(
    `UPDATE tenant.crm_contact_account_relationships
     SET status='inactive', updated_by=$3, updated_at=now()
     WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, relationshipId, context.userId],
  );
  return listContactAccountRelationships(client, context, contactId);
}

// Called during a governed Contact or Account merge to reconcile
// relationship rows so the survivor never ends up with duplicate
// (contact_id, party_id) pairs and never silently loses a relationship.
export async function reconcileRelationshipsOnContactMerge(
  client,
  context,
  sourceContactId,
  survivorContactId,
) {
  // Any Account both the source and survivor already relate to: keep the
  // survivor's existing row (preserve its role/primary flag/notes as-is,
  // consistent with the governed merge engine's existing "survivor's values
  // win" default), and drop the source's now-redundant row instead of
  // letting the FK repoint step collide against the unique constraint.
  await client.query(
    `DELETE FROM tenant.crm_contact_account_relationships source_rel
     WHERE source_rel.organization_id=$1 AND source_rel.contact_id=$2
       AND EXISTS (
         SELECT 1 FROM tenant.crm_contact_account_relationships survivor_rel
         WHERE survivor_rel.organization_id=$1 AND survivor_rel.contact_id=$3
           AND survivor_rel.party_id = source_rel.party_id
       )`,
    [context.organizationId, sourceContactId, survivorContactId],
  );
  // Every remaining (non-overlapping) source relationship repoints onto the
  // survivor — never orphaned.
  await client.query(
    `UPDATE tenant.crm_contact_account_relationships
     SET contact_id=$3, is_primary=false, updated_by=$4, updated_at=now()
     WHERE organization_id=$1 AND contact_id=$2`,
    [context.organizationId, sourceContactId, survivorContactId, context.userId],
  );
  // If the survivor lost its primary somehow (shouldn't happen — its own
  // primary row is untouched above — but guard defensively) or never had
  // one, promote whatever remains so the pointer stays valid.
  const hasPrimary = await client.query(
    `SELECT 1 FROM tenant.crm_contact_account_relationships
     WHERE organization_id=$1 AND contact_id=$2 AND is_primary=true AND status='active' LIMIT 1`,
    [context.organizationId, survivorContactId],
  );
  if (!hasPrimary.rows[0]) {
    const candidate = await client.query(
      `SELECT id FROM tenant.crm_contact_account_relationships
       WHERE organization_id=$1 AND contact_id=$2 AND status='active'
       ORDER BY created_at LIMIT 1`,
      [context.organizationId, survivorContactId],
    );
    if (candidate.rows[0]) {
      await client.query(
        `UPDATE tenant.crm_contact_account_relationships SET is_primary=true, updated_at=now()
         WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, candidate.rows[0].id],
      );
    }
  }
  await syncPrimaryContactPointer(client, context, survivorContactId);
}

// Called during a governed Account merge: every relationship pointing at
// the source Account is repointed to the survivor, de-duplicating any
// Contact that already related to both.
export async function reconcileRelationshipsOnAccountMerge(
  client,
  context,
  sourcePartyId,
  survivorPartyId,
) {
  await client.query(
    `DELETE FROM tenant.crm_contact_account_relationships source_rel
     WHERE source_rel.organization_id=$1 AND source_rel.party_id=$2
       AND EXISTS (
         SELECT 1 FROM tenant.crm_contact_account_relationships survivor_rel
         WHERE survivor_rel.organization_id=$1 AND survivor_rel.party_id=$3
           AND survivor_rel.contact_id = source_rel.contact_id
       )`,
    [context.organizationId, sourcePartyId, survivorPartyId],
  );
  const repointed = await client.query(
    `UPDATE tenant.crm_contact_account_relationships
     SET party_id=$3, updated_by=$4, updated_at=now()
     WHERE organization_id=$1 AND party_id=$2
     RETURNING contact_id`,
    [context.organizationId, sourcePartyId, survivorPartyId, context.userId],
  );
  for (const row of repointed.rows) {
    await syncPrimaryContactPointer(client, context, row.contact_id);
  }
}
