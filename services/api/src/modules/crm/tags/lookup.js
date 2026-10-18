// Reading and copying a record's tags (no imports of the records themselves, so leads and deals can load their tags).
const toTag = (row) => ({ id: row.id, name: row.name, color: row.color });

// The tags of many records at once: Map(entityId → [tag]).
export async function tagsByRecord(client, organizationId, entityType, entityIds) {
  const ids = [...new Set(entityIds)].filter(Boolean);
  const map = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return map;
  const { rows } = await client.query(
    `SELECT link.entity_id, tag.id, tag.name, tag.color FROM tenant.crm_record_tags link JOIN tenant.crm_tags tag ON tag.id = link.tag_id
      WHERE link.organization_id = $1 AND link.entity_type = $2 AND link.entity_id = ANY($3::uuid[]) ORDER BY lower(tag.name)`,
    [organizationId, entityType, ids]);
  for (const row of rows) map.get(row.entity_id)?.push(toTag(row));
  return map;
}

// Conversion: a lead's tags go on to its deal.
export async function copyLeadTagsToDeal(client, organizationId, leadId, opportunityId, userId = null) {
  await client.query(
    `INSERT INTO tenant.crm_record_tags (organization_id, tag_id, entity_type, entity_id, created_by)
     SELECT organization_id, tag_id, 'opportunity', $3, $4 FROM tenant.crm_record_tags WHERE organization_id = $1 AND entity_type = 'lead' AND entity_id = $2
     ON CONFLICT DO NOTHING`, [organizationId, leadId, opportunityId, userId]);
}

