// Ported from docs/frontend-rebuild/recovered-platform-code/apps/web/src/
// core/shared-platform.ts (entity-tagging slice).
export class TagError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "TagError";
    this.status = status;
  }
}

function text(value, name, maximum = 240) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TagError(400, `${name} is required.`);
  if (normalized.length > maximum) throw new TagError(400, `${name} is too long.`);
  return normalized;
}

function optionalText(value, maximum = 2_000) {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > maximum) throw new TagError(400, "The submitted text is too long.");
  return normalized;
}

export async function createTagDefinition(client, session, input) {
  const entityType = text(input.entityType, "Tag entity type", 120);
  const name = text(input.name, "Tag name", 120);
  const color = input.color == null ? null : optionalText(input.color, 40);
  if (color && !/^#[0-9a-f]{6}$/i.test(color)) {
    throw new TagError(400, "Tag color must be a six-digit hexadecimal colour.");
  }
  const result = await client.query(
    `INSERT INTO tag_definitions(organization_id,entity_type,name,color,created_by)
     VALUES($1,$2,$3,$4,$5)
     ON CONFLICT (organization_id,entity_type,name) DO UPDATE SET
       color=EXCLUDED.color,status='active',updated_at=now()
     RETURNING id,entity_type,name,color`,
    [session.organizationId, entityType, name, color, session.userId],
  );
  return result.rows[0];
}

export async function listTagDefinitions(client, organizationId, entityTypeValue) {
  const entityType = entityTypeValue ? text(entityTypeValue, "Tag entity type", 120) : null;
  const result = await client.query(
    `SELECT id,entity_type,name,color,status,updated_at
       FROM tag_definitions
      WHERE organization_id=$1 AND ($2::text IS NULL OR entity_type=$2)
      ORDER BY entity_type,name,id`,
    [organizationId, entityType],
  );
  return result.rows;
}

export async function assignEntityTag(client, session, input) {
  const tagId = text(input.tagId, "Tag id", 80);
  const entityType = text(input.entityType, "Tagged entity type", 120);
  const entityId = text(input.entityId, "Tagged entity id", 240);
  const inserted = await client.query(
    `INSERT INTO entity_tags(organization_id,tag_id,entity_type,entity_id,assigned_by)
     SELECT $1,tag.id,$3,$4,$5
       FROM tag_definitions tag
      WHERE tag.id=$2 AND tag.organization_id=$1 AND tag.entity_type=$3 AND tag.status='active'
     ON CONFLICT (organization_id,tag_id,entity_type,entity_id) DO NOTHING
     RETURNING tag_id`,
    [session.organizationId, tagId, entityType, entityId, session.userId],
  );
  if (!inserted.rows[0]) {
    const existing = await client.query(
      `SELECT entity_tag.tag_id
         FROM entity_tags entity_tag
         JOIN tag_definitions tag ON tag.id=entity_tag.tag_id AND tag.organization_id=entity_tag.organization_id
        WHERE entity_tag.organization_id=$1 AND entity_tag.tag_id=$2
          AND entity_tag.entity_type=$3 AND entity_tag.entity_id=$4 AND tag.status='active'`,
      [session.organizationId, tagId, entityType, entityId],
    );
    if (!existing.rows[0]) throw new TagError(404, "Active tag definition not found for this entity type.");
    return { tagId, replayed: true };
  }
  return { tagId, replayed: false };
}

export async function removeEntityTag(client, session, input) {
  const tagId = text(input.tagId, "Tag id", 80);
  const entityType = text(input.entityType, "Tagged entity type", 120);
  const entityId = text(input.entityId, "Tagged entity id", 240);
  await client.query(
    `DELETE FROM entity_tags WHERE organization_id=$1 AND tag_id=$2 AND entity_type=$3 AND entity_id=$4`,
    [session.organizationId, tagId, entityType, entityId],
  );
}

export async function listEntityTags(client, organizationId, entityTypeValue, entityIdValue) {
  const entityType = text(entityTypeValue, "Tagged entity type", 120);
  const entityId = text(entityIdValue, "Tagged entity id", 240);
  const result = await client.query(
    `SELECT tag.id,tag.name,tag.color,entity_tag.assigned_at
       FROM entity_tags entity_tag
       JOIN tag_definitions tag ON tag.id=entity_tag.tag_id AND tag.organization_id=entity_tag.organization_id
      WHERE entity_tag.organization_id=$1 AND entity_tag.entity_type=$2 AND entity_tag.entity_id=$3
        AND tag.status='active'
      ORDER BY tag.name,tag.id`,
    [organizationId, entityType, entityId],
  );
  return result.rows;
}
