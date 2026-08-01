const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CrmFoundationError extends Error {
  constructor(status, message, code = "CRM_FOUNDATION_ERROR") {
    super(message);
    this.name = "CrmFoundationError";
    this.status = status;
    this.code = code;
  }
}

function assertId(value, label) {
  if (!UUID.test(String(value || ""))) {
    throw new CrmFoundationError(
      400,
      `${label} is invalid.`,
      "CRM_IDENTIFIER_INVALID",
    );
  }
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function normalizePhone(value) {
  return String(value || "")
    .replace(/\D+/g, "")
    .slice(-15);
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

export async function findAccountDuplicates(client, context, input = {}) {
  const name = normalizeText(
    input.name || input.displayName || input.legalName,
  );
  const gstin = String(input.gstin || "")
    .trim()
    .toUpperCase();
  const pan = String(input.pan || "")
    .trim()
    .toUpperCase();
  const excludeId = input.excludeId || null;
  if (!name && !gstin && !pan) return [];
  const result = await client.query(
    `SELECT party.id, party.code, party.display_name, party.legal_name, party.gstin,
            party.pan, party.party_type, party.status,
            ((CASE WHEN $3 <> '' AND upper(coalesce(party.gstin,'')) = $3 THEN 70 ELSE 0 END) +
             (CASE WHEN $4 <> '' AND upper(coalesce(party.pan,'')) = $4 THEN 45 ELSE 0 END) +
             (CASE WHEN $2 <> '' AND regexp_replace(lower(coalesce(party.legal_name,party.display_name)), '[^a-z0-9]+', '', 'g') = $2 THEN 35 ELSE 0 END))::int AS match_score
       FROM tenant.business_parties party
      WHERE party.organization_id = $1
        AND party.status = 'active'
        AND ($5::uuid IS NULL OR party.id <> $5)
        AND (($3 <> '' AND upper(coalesce(party.gstin,'')) = $3)
          OR ($4 <> '' AND upper(coalesce(party.pan,'')) = $4)
          OR ($2 <> '' AND regexp_replace(lower(coalesce(party.legal_name,party.display_name)), '[^a-z0-9]+', '', 'g') = $2))
      ORDER BY match_score DESC, party.updated_at DESC
      LIMIT 25`,
    [context.organizationId, name, gstin, pan, excludeId],
  );
  return result.rows;
}

export async function findContactDuplicates(client, context, input = {}) {
  const email = normalizeEmail(input.email);
  const mobile = normalizePhone(input.mobile || input.phone);
  const firstName = normalizeText(input.firstName);
  const lastName = normalizeText(input.lastName);
  const excludeId = input.excludeId || null;
  if (!email && !mobile && !firstName) return [];
  const result = await client.query(
    `SELECT contact.id, contact.party_id, contact.first_name, contact.last_name,
            contact.email, contact.mobile, contact.phone, contact.designation,
            party.display_name AS account_name,
            ((CASE WHEN $2 <> '' AND lower(coalesce(contact.email,'')) = $2 THEN 70 ELSE 0 END) +
             (CASE WHEN $3 <> '' AND right(regexp_replace(coalesce(contact.mobile,contact.phone,''), '\\D', '', 'g'), 15) = $3 THEN 55 ELSE 0 END) +
             (CASE WHEN $4 <> '' AND regexp_replace(lower(contact.first_name), '[^a-z0-9]+', '', 'g') = $4
                        AND regexp_replace(lower(coalesce(contact.last_name,'')), '[^a-z0-9]+', '', 'g') = $5 THEN 30 ELSE 0 END))::int AS match_score
       FROM tenant.contacts contact
       JOIN tenant.business_parties party
         ON party.organization_id = contact.organization_id AND party.id = contact.party_id
      WHERE contact.organization_id = $1
        AND contact.status = 'active'
        AND ($6::uuid IS NULL OR contact.id <> $6)
        AND (($2 <> '' AND lower(coalesce(contact.email,'')) = $2)
          OR ($3 <> '' AND right(regexp_replace(coalesce(contact.mobile,contact.phone,''), '\\D', '', 'g'), 15) = $3)
          OR ($4 <> '' AND regexp_replace(lower(contact.first_name), '[^a-z0-9]+', '', 'g') = $4
                       AND regexp_replace(lower(coalesce(contact.last_name,'')), '[^a-z0-9]+', '', 'g') = $5))
      ORDER BY match_score DESC, contact.updated_at DESC
      LIMIT 25`,
    [context.organizationId, email, mobile, firstName, lastName, excludeId],
  );
  return result.rows;
}

async function lockParty(client, context, id) {
  assertId(id, "Account");
  const result = await client.query(
    `SELECT * FROM tenant.business_parties
      WHERE organization_id = $1 AND id = $2
      FOR UPDATE`,
    [context.organizationId, id],
  );
  if (!result.rows[0])
    throw new CrmFoundationError(
      404,
      "Account not found.",
      "CRM_ACCOUNT_NOT_FOUND",
    );
  return result.rows[0];
}

async function lockContact(client, context, id) {
  assertId(id, "Contact");
  const result = await client.query(
    `SELECT * FROM tenant.contacts
      WHERE organization_id = $1 AND id = $2
      FOR UPDATE`,
    [context.organizationId, id],
  );
  if (!result.rows[0])
    throw new CrmFoundationError(
      404,
      "Contact not found.",
      "CRM_CONTACT_NOT_FOUND",
    );
  return result.rows[0];
}

export async function mergeAccounts(
  client,
  context,
  sourceId,
  survivorId,
  reason = null,
) {
  if (sourceId === survivorId)
    throw new CrmFoundationError(400, "Choose two different accounts.");
  const [source, survivor] = await Promise.all([
    lockParty(client, context, sourceId),
    lockParty(client, context, survivorId),
  ]);
  if (source.status !== "active" || survivor.status !== "active") {
    throw new CrmFoundationError(
      409,
      "Both accounts must be active before merging.",
    );
  }

  await client.query(
    `UPDATE tenant.contacts
        SET is_primary = false, updated_by = $1, updated_at = now()
      WHERE organization_id = $2 AND party_id = $3 AND is_primary = true
        AND EXISTS (SELECT 1 FROM tenant.contacts WHERE organization_id = $2 AND party_id = $4 AND is_primary = true AND status='active')`,
    [context.userId, context.organizationId, sourceId, survivorId],
  );

  const references = [
    ["contacts", "party_id"],
    ["addresses", "party_id"],
    ["crm_opportunities", "party_id"],
    ["crm_activities", "party_id"],
    ["crm_communications", "party_id"],
    ["crm_account_plans", "party_id"],
    ["crm_account_stakeholders", "party_id"],
    ["crm_buying_committees", "party_id"],
    ["crm_account_signals", "party_id"],
    ["crm_field_visits", "party_id"],
  ];
  for (const [table, column] of references) {
    await client.query(
      `UPDATE tenant.${table} SET ${column} = $1, updated_at = now() WHERE organization_id = $2 AND ${column} = $3`,
      [survivorId, context.organizationId, sourceId],
    );
  }
  await client.query(
    `UPDATE tenant.crm_relationship_edges SET status='inactive', updated_by=$1, updated_at=now()
      WHERE organization_id=$2 AND status='active' AND ((from_entity_type='party' AND from_entity_id=$3 AND to_entity_type='party' AND to_entity_id=$4)
        OR (to_entity_type='party' AND to_entity_id=$3 AND from_entity_type='party' AND from_entity_id=$4))`,
    [context.userId, context.organizationId, sourceId, survivorId],
  );
  await client.query(
    `UPDATE tenant.crm_relationship_edges
        SET from_entity_id=$1, updated_by=$2, updated_at=now()
      WHERE organization_id=$3 AND status='active' AND from_entity_type='party' AND from_entity_id=$4`,
    [survivorId, context.userId, context.organizationId, sourceId],
  );
  await client.query(
    `UPDATE tenant.crm_relationship_edges
        SET to_entity_id=$1, updated_by=$2, updated_at=now()
      WHERE organization_id=$3 AND status='active' AND to_entity_type='party' AND to_entity_id=$4`,
    [survivorId, context.userId, context.organizationId, sourceId],
  );
  await client.query(
    `UPDATE tenant.crm_relationship_edges SET status='inactive', updated_by=$1, updated_at=now()
      WHERE organization_id=$2 AND from_entity_type=to_entity_type AND from_entity_id=to_entity_id`,
    [context.userId, context.organizationId],
  );

  await client.query(
    `UPDATE tenant.business_parties
        SET status='inactive', updated_by=$1, updated_at=now()
      WHERE organization_id=$2 AND id=$3`,
    [context.userId, context.organizationId, sourceId],
  );
  const history = await client.query(
    `INSERT INTO tenant.crm_account_merge_history
      (organization_id, source_party_id, survivor_party_id, source_snapshot, survivor_snapshot, reason, merged_by)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)
     RETURNING *`,
    [
      context.organizationId,
      sourceId,
      survivorId,
      JSON.stringify(source),
      JSON.stringify(survivor),
      reason,
      context.userId,
    ],
  );
  return history.rows[0];
}

export async function mergeContacts(
  client,
  context,
  sourceId,
  survivorId,
  reason = null,
) {
  if (sourceId === survivorId)
    throw new CrmFoundationError(400, "Choose two different contacts.");
  const [source, survivor] = await Promise.all([
    lockContact(client, context, sourceId),
    lockContact(client, context, survivorId),
  ]);
  if (source.status !== "active" || survivor.status !== "active") {
    throw new CrmFoundationError(
      409,
      "Both contacts must be active before merging.",
    );
  }
  const references = [
    ["crm_opportunities", "contact_id"],
    ["crm_activities", "contact_id"],
    ["crm_communications", "contact_id"],
    ["crm_account_stakeholders", "contact_id"],
    ["crm_buying_committee_members", "contact_id"],
    ["crm_field_visits", "contact_id"],
  ];
  for (const [table, column] of references) {
    await client.query(
      `UPDATE tenant.${table} SET ${column} = $1, updated_at = now() WHERE organization_id = $2 AND ${column} = $3`,
      [survivorId, context.organizationId, sourceId],
    );
  }
  await client.query(
    `UPDATE tenant.crm_relationship_edges SET status='inactive', updated_by=$1, updated_at=now()
      WHERE organization_id=$2 AND status='active' AND ((from_entity_type='contact' AND from_entity_id=$3 AND to_entity_type='contact' AND to_entity_id=$4)
        OR (to_entity_type='contact' AND to_entity_id=$3 AND from_entity_type='contact' AND from_entity_id=$4))`,
    [context.userId, context.organizationId, sourceId, survivorId],
  );
  await client.query(
    `UPDATE tenant.crm_relationship_edges SET from_entity_id=$1, updated_by=$2, updated_at=now()
      WHERE organization_id=$3 AND status='active' AND from_entity_type='contact' AND from_entity_id=$4`,
    [survivorId, context.userId, context.organizationId, sourceId],
  );
  await client.query(
    `UPDATE tenant.crm_relationship_edges SET to_entity_id=$1, updated_by=$2, updated_at=now()
      WHERE organization_id=$3 AND status='active' AND to_entity_type='contact' AND to_entity_id=$4`,
    [survivorId, context.userId, context.organizationId, sourceId],
  );
  await client.query(
    `UPDATE tenant.crm_relationship_edges SET status='inactive', updated_by=$1, updated_at=now()
      WHERE organization_id=$2 AND from_entity_type=to_entity_type AND from_entity_id=to_entity_id`,
    [context.userId, context.organizationId],
  );
  await client.query(
    `UPDATE tenant.contacts SET status='inactive', is_primary=false, updated_by=$1, updated_at=now()
      WHERE organization_id=$2 AND id=$3`,
    [context.userId, context.organizationId, sourceId],
  );
  const history = await client.query(
    `INSERT INTO tenant.crm_contact_merge_history
      (organization_id, source_contact_id, survivor_contact_id, source_snapshot, survivor_snapshot, reason, merged_by)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7)
     RETURNING *`,
    [
      context.organizationId,
      sourceId,
      survivorId,
      JSON.stringify(source),
      JSON.stringify(survivor),
      reason,
      context.userId,
    ],
  );
  return history.rows[0];
}

export async function getRelationshipGraph(client, context, partyId) {
  assertId(partyId, "Account");
  const result = await client.query(
    `SELECT edge.id, edge.relationship_type, edge.strength, edge.notes,
            edge.from_entity_type, edge.from_entity_id,
            CASE edge.from_entity_type
              WHEN 'party' THEN from_party.display_name
              WHEN 'contact' THEN trim(concat(from_contact.first_name,' ',coalesce(from_contact.last_name,'')))
              ELSE edge.from_entity_type
            END AS from_name,
            edge.to_entity_type, edge.to_entity_id,
            CASE edge.to_entity_type
              WHEN 'party' THEN to_party.display_name
              WHEN 'contact' THEN trim(concat(to_contact.first_name,' ',coalesce(to_contact.last_name,'')))
              ELSE edge.to_entity_type
            END AS to_name
       FROM tenant.crm_relationship_edges edge
       LEFT JOIN tenant.business_parties from_party ON edge.from_entity_type='party' AND from_party.organization_id=edge.organization_id AND from_party.id=edge.from_entity_id
       LEFT JOIN tenant.business_parties to_party ON edge.to_entity_type='party' AND to_party.organization_id=edge.organization_id AND to_party.id=edge.to_entity_id
       LEFT JOIN tenant.contacts from_contact ON edge.from_entity_type='contact' AND from_contact.organization_id=edge.organization_id AND from_contact.id=edge.from_entity_id
       LEFT JOIN tenant.contacts to_contact ON edge.to_entity_type='contact' AND to_contact.organization_id=edge.organization_id AND to_contact.id=edge.to_entity_id
      WHERE edge.organization_id=$1 AND edge.status='active'
        AND ((edge.from_entity_type='party' AND edge.from_entity_id=$2)
          OR (edge.to_entity_type='party' AND edge.to_entity_id=$2))
      ORDER BY edge.updated_at DESC`,
    [context.organizationId, partyId],
  );
  return result.rows;
}
