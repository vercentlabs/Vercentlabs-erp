import { createHash } from "node:crypto";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CRM_ACCOUNT_INTELLIGENCE_CAPABILITY_IDS = Object.freeze([
  "CRM-027",
  "CRM-028",
  "CRM-029",
  "CRM-030",
  "CRM-035",
]);

export class CrmAccountIntelligenceError extends Error {
  constructor(status, message, code = "CRM_ACCOUNT_INTELLIGENCE_ERROR") {
    super(message);
    this.name = "CrmAccountIntelligenceError";
    this.status = status;
    this.code = code;
  }
}

const text = (value) => String(value ?? "").trim();
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

function assertId(value, label) {
  if (!UUID.test(text(value))) {
    throw new CrmAccountIntelligenceError(
      400,
      `${label} is invalid.`,
      "CRM_IDENTIFIER_INVALID",
    );
  }
  return text(value);
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function crmAccountIntelligenceHash(value) {
  return createHash("sha256").update(stable(value)).digest("hex");
}

async function account(client, context, partyId, lock = false) {
  const id = assertId(partyId, "Account");
  const result = await client.query(
    `SELECT party.*,parent.display_name AS parent_name
     FROM tenant.business_parties party
     LEFT JOIN tenant.business_parties parent
       ON parent.organization_id=party.organization_id AND parent.id=party.parent_party_id
     WHERE party.organization_id=$1 AND party.id=$2${lock ? " FOR UPDATE OF party" : ""}`,
    [context.organizationId, id],
  );
  if (!result.rows[0]) {
    throw new CrmAccountIntelligenceError(
      404,
      "Account not found.",
      "CRM_ACCOUNT_NOT_FOUND",
    );
  }
  return result.rows[0];
}

async function contact(client, context, contactId, lock = false) {
  const id = assertId(contactId, "Contact");
  const result = await client.query(
    `SELECT contact.*,party.display_name AS account_name
     FROM tenant.contacts contact
     JOIN tenant.business_parties party
       ON party.organization_id=contact.organization_id AND party.id=contact.party_id
     WHERE contact.organization_id=$1 AND contact.id=$2${lock ? " FOR UPDATE OF contact" : ""}`,
    [context.organizationId, id],
  );
  if (!result.rows[0]) {
    throw new CrmAccountIntelligenceError(
      404,
      "Contact not found.",
      "CRM_CONTACT_NOT_FOUND",
    );
  }
  return result.rows[0];
}

export async function getAccountHierarchy(client, context, partyId) {
  const root = await account(client, context, partyId);
  const ancestors = await client.query(
    `WITH RECURSIVE tree AS (
       SELECT party.id,party.parent_party_id,party.display_name,party.legal_name,party.party_type,party.status,0 AS depth
       FROM tenant.business_parties party
       WHERE party.organization_id=$1 AND party.id=$2
       UNION ALL
       SELECT parent.id,parent.parent_party_id,parent.display_name,parent.legal_name,parent.party_type,parent.status,tree.depth+1
       FROM tenant.business_parties parent
       JOIN tree ON tree.parent_party_id=parent.id
       WHERE parent.organization_id=$1 AND tree.depth<50
     )
     SELECT * FROM tree WHERE depth>0 ORDER BY depth DESC`,
    [context.organizationId, partyId],
  );
  const descendants = await client.query(
    `WITH RECURSIVE tree AS (
       SELECT party.id,party.parent_party_id,party.display_name,party.legal_name,party.party_type,party.status,0 AS depth
       FROM tenant.business_parties party
       WHERE party.organization_id=$1 AND party.id=$2
       UNION ALL
       SELECT child.id,child.parent_party_id,child.display_name,child.legal_name,child.party_type,child.status,tree.depth+1
       FROM tenant.business_parties child
       JOIN tree ON child.parent_party_id=tree.id
       WHERE child.organization_id=$1 AND tree.depth<50
     )
     SELECT * FROM tree WHERE depth>0 ORDER BY depth,display_name`,
    [context.organizationId, partyId],
  );
  const history = await client.query(
    `SELECT event.*,previous_parent.display_name AS previous_parent_name,new_parent.display_name AS new_parent_name,
            actor.full_name AS changed_by_name
     FROM tenant.crm_account_hierarchy_events event
     LEFT JOIN tenant.business_parties previous_parent
       ON previous_parent.organization_id=event.organization_id AND previous_parent.id=event.previous_parent_party_id
     LEFT JOIN tenant.business_parties new_parent
       ON new_parent.organization_id=event.organization_id AND new_parent.id=event.new_parent_party_id
     LEFT JOIN public.users actor ON actor.id=event.changed_by
     WHERE event.organization_id=$1 AND event.party_id=$2
     ORDER BY event.changed_at DESC LIMIT 100`,
    [context.organizationId, partyId],
  );
  return {
    account: root,
    ancestors: ancestors.rows,
    descendants: descendants.rows,
    history: history.rows,
    metrics: {
      ancestorCount: ancestors.rows.length,
      descendantCount: descendants.rows.length,
      hierarchyDepth: Math.max(
        0,
        ...descendants.rows.map((row) => Number(row.depth || 0)),
      ),
    },
  };
}

export async function setAccountParent(
  client,
  context,
  partyId,
  parentPartyId,
  reason = null,
) {
  const childId = assertId(partyId, "Account");
  const nextParentId = parentPartyId
    ? assertId(parentPartyId, "Parent account")
    : null;
  if (nextParentId === childId) {
    throw new CrmAccountIntelligenceError(
      409,
      "An account cannot be its own parent.",
      "CRM_ACCOUNT_HIERARCHY_SELF_PARENT",
    );
  }
  const child = await account(client, context, childId, true);
  if (nextParentId) {
    const parent = await account(client, context, nextParentId, true);
    if (parent.status !== "active") {
      throw new CrmAccountIntelligenceError(
        409,
        "The parent account must be active.",
        "CRM_ACCOUNT_HIERARCHY_PARENT_INACTIVE",
      );
    }
    const cycle = await client.query(
      `WITH RECURSIVE ancestors AS (
         SELECT party.id,party.parent_party_id
         FROM tenant.business_parties party
         WHERE party.organization_id=$1 AND party.id=$2
         UNION ALL
         SELECT parent.id,parent.parent_party_id
         FROM tenant.business_parties parent
         JOIN ancestors child ON child.parent_party_id=parent.id
         WHERE parent.organization_id=$1
       ) SELECT 1 FROM ancestors WHERE id=$3 LIMIT 1`,
      [context.organizationId, nextParentId, childId],
    );
    if (cycle.rows[0]) {
      throw new CrmAccountIntelligenceError(
        409,
        "The selected parent would create an account hierarchy cycle.",
        "CRM_ACCOUNT_HIERARCHY_CYCLE",
      );
    }
  }
  if ((child.parent_party_id || null) === nextParentId) return child;
  const updated = await client.query(
    `UPDATE tenant.business_parties
     SET parent_party_id=$1,updated_by=$2,updated_at=now()
     WHERE organization_id=$3 AND id=$4 RETURNING *`,
    [nextParentId, context.userId, context.organizationId, childId],
  );
  await client.query(
    `INSERT INTO tenant.crm_account_hierarchy_events(
       organization_id,party_id,previous_parent_party_id,new_parent_party_id,action,reason,changed_by
     ) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      context.organizationId,
      childId,
      child.parent_party_id || null,
      nextParentId,
      nextParentId ? "parent_set" : "parent_cleared",
      text(reason) || null,
      context.userId,
    ],
  );
  return updated.rows[0];
}

async function foreignKeyReferences(client, referencedTable) {
  const result = await client.query(
    `SELECT source.relname AS table_name,source_column.attname AS column_name
     FROM pg_constraint constraint_row
     JOIN pg_class source ON source.oid=constraint_row.conrelid
     JOIN pg_namespace source_namespace ON source_namespace.oid=source.relnamespace
     JOIN pg_class target ON target.oid=constraint_row.confrelid
     JOIN pg_namespace target_namespace ON target_namespace.oid=target.relnamespace
     JOIN LATERAL unnest(constraint_row.conkey,constraint_row.confkey)
       AS key_pair(source_attnum,target_attnum) ON true
     JOIN pg_attribute source_column
       ON source_column.attrelid=source.oid AND source_column.attnum=key_pair.source_attnum
     JOIN pg_attribute target_column
       ON target_column.attrelid=target.oid AND target_column.attnum=key_pair.target_attnum
     WHERE constraint_row.contype='f'
       AND source_namespace.nspname='tenant'
       AND target_namespace.nspname='tenant'
       AND target.relname=$1
       AND target_column.attname='id'
     ORDER BY source.relname,source_column.attname`,
    [referencedTable],
  );
  return result.rows;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function repointReferences(
  client,
  context,
  referencedTable,
  sourceId,
  survivorId,
  excludedTables,
) {
  const references = await foreignKeyReferences(client, referencedTable);
  const moved = [];
  for (const reference of references) {
    const tableName = text(reference.table_name);
    const columnName = text(reference.column_name);
    if (!tableName || !columnName || excludedTables.has(tableName)) continue;
    try {
      const result = await client.query(
        `UPDATE tenant.${quoteIdentifier(tableName)}
         SET ${quoteIdentifier(columnName)}=$1
         WHERE organization_id=$2 AND ${quoteIdentifier(columnName)}=$3`,
        [survivorId, context.organizationId, sourceId],
      );
      moved.push({
        tableName,
        columnName,
        rowCount: Number(result.rowCount || 0),
      });
    } catch (error) {
      if (error && typeof error === "object" && error.code === "23505") {
        throw new CrmAccountIntelligenceError(
          409,
          `The merge would create a duplicate relationship in ${tableName}.${columnName}. Resolve that conflict before merging.`,
          "CRM_MERGE_RELATIONSHIP_CONFLICT",
        );
      }
      throw error;
    }
  }
  return moved;
}

export async function previewAccountMerge(
  client,
  context,
  sourceId,
  survivorId,
) {
  const source = await account(client, context, sourceId);
  const survivor = await account(client, context, survivorId);
  if (source.id === survivor.id) {
    throw new CrmAccountIntelligenceError(
      400,
      "Choose two different accounts.",
    );
  }
  const references = await foreignKeyReferences(client, "business_parties");
  const impact = [];
  for (const reference of references) {
    const tableName = text(reference.table_name);
    const columnName = text(reference.column_name);
    if (
      [
        "business_parties",
        "crm_account_merge_history",
        "crm_entity_merge_aliases",
        "crm_account_hierarchy_events",
      ].includes(tableName)
    )
      continue;
    const count = await client.query(
      `SELECT count(*)::int AS count FROM tenant.${quoteIdentifier(tableName)}
       WHERE organization_id=$1 AND ${quoteIdentifier(columnName)}=$2`,
      [context.organizationId, sourceId],
    );
    if (Number(count.rows[0]?.count || 0) > 0) {
      impact.push({
        tableName,
        columnName,
        count: Number(count.rows[0].count),
      });
    }
  }
  return { source, survivor, impact };
}

export async function previewContactMerge(
  client,
  context,
  sourceId,
  survivorId,
) {
  const source = await contact(client, context, sourceId);
  const survivor = await contact(client, context, survivorId);
  if (source.id === survivor.id) {
    throw new CrmAccountIntelligenceError(
      400,
      "Choose two different contacts.",
    );
  }
  const references = await foreignKeyReferences(client, "contacts");
  const impact = [];
  for (const reference of references) {
    const tableName = text(reference.table_name);
    const columnName = text(reference.column_name);
    if (
      ["crm_contact_merge_history", "crm_entity_merge_aliases"].includes(
        tableName,
      )
    )
      continue;
    const count = await client.query(
      `SELECT count(*)::int AS count FROM tenant.${quoteIdentifier(tableName)}
       WHERE organization_id=$1 AND ${quoteIdentifier(columnName)}=$2`,
      [context.organizationId, sourceId],
    );
    if (Number(count.rows[0]?.count || 0) > 0) {
      impact.push({
        tableName,
        columnName,
        count: Number(count.rows[0].count),
      });
    }
  }
  return { source, survivor, impact };
}

async function assertAccountMergeHierarchySafe(
  client,
  context,
  sourceId,
  survivorId,
) {
  const descendant = await client.query(
    `WITH RECURSIVE descendants AS (
       SELECT party.id
       FROM tenant.business_parties party
       WHERE party.organization_id=$1 AND party.parent_party_id=$2
       UNION ALL
       SELECT child.id
       FROM tenant.business_parties child
       JOIN descendants parent ON child.parent_party_id=parent.id
       WHERE child.organization_id=$1
     )
     SELECT 1 FROM descendants WHERE id=$3 LIMIT 1`,
    [context.organizationId, sourceId, survivorId],
  );
  if (descendant.rows[0]) {
    throw new CrmAccountIntelligenceError(
      409,
      "A parent account cannot be merged into one of its descendants. Reparent the hierarchy first.",
      "CRM_ACCOUNT_MERGE_DESCENDANT_CONFLICT",
    );
  }
}

export async function mergeAccountsGoverned(
  client,
  context,
  sourceId,
  survivorId,
  reason = null,
) {
  const sourceKey = assertId(sourceId, "Source account");
  const survivorKey = assertId(survivorId, "Surviving account");
  if (sourceKey === survivorKey) {
    throw new CrmAccountIntelligenceError(
      400,
      "Choose two different accounts.",
    );
  }
  const ordered = [sourceKey, survivorKey].sort();
  await client.query(
    `SELECT id FROM tenant.business_parties
     WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
    [context.organizationId, ordered],
  );
  const preview = await previewAccountMerge(
    client,
    context,
    sourceKey,
    survivorKey,
  );
  if (
    preview.source.status !== "active" ||
    preview.survivor.status !== "active"
  ) {
    throw new CrmAccountIntelligenceError(
      409,
      "Both accounts must be active before merging.",
    );
  }
  await assertAccountMergeHierarchySafe(
    client,
    context,
    sourceKey,
    survivorKey,
  );
  await client.query(
    `UPDATE tenant.contacts SET is_primary=false,updated_by=$1,updated_at=now()
     WHERE organization_id=$2 AND party_id=$3 AND is_primary=true
       AND EXISTS(SELECT 1 FROM tenant.contacts WHERE organization_id=$2 AND party_id=$4 AND is_primary=true AND status='active')`,
    [context.userId, context.organizationId, sourceKey, survivorKey],
  );
  const reparented = await client.query(
    `UPDATE tenant.business_parties
     SET parent_party_id=$1,updated_by=$2,updated_at=now()
     WHERE organization_id=$3 AND parent_party_id=$4 AND id<>$1
     RETURNING id`,
    [survivorKey, context.userId, context.organizationId, sourceKey],
  );
  for (const row of reparented.rows) {
    await client.query(
      `INSERT INTO tenant.crm_account_hierarchy_events(
         organization_id,party_id,previous_parent_party_id,new_parent_party_id,action,reason,changed_by
       ) VALUES($1,$2,$3,$4,'merge_reparented',$5,$6)`,
      [
        context.organizationId,
        row.id,
        sourceKey,
        survivorKey,
        text(reason) || "Reparented during governed account merge.",
        context.userId,
      ],
    );
  }
  const moved = await repointReferences(
    client,
    context,
    "business_parties",
    sourceKey,
    survivorKey,
    new Set([
      "business_parties",
      "crm_account_merge_history",
      "crm_entity_merge_aliases",
      "crm_account_hierarchy_events",
    ]),
  );
  await client.query(
    `UPDATE tenant.crm_activities SET entity_id=$1,updated_at=now()
     WHERE organization_id=$2 AND entity_type='party' AND entity_id=$3`,
    [survivorKey, context.organizationId, sourceKey],
  );
  await client.query(
    `UPDATE tenant.crm_relationship_edges
     SET status='inactive',updated_by=$1,updated_at=now()
     WHERE organization_id=$2 AND status='active'
       AND ((from_entity_type='party' AND from_entity_id=$3 AND to_entity_type='party' AND to_entity_id=$4)
         OR (to_entity_type='party' AND to_entity_id=$3 AND from_entity_type='party' AND from_entity_id=$4))`,
    [context.userId, context.organizationId, sourceKey, survivorKey],
  );
  await client.query(
    `UPDATE tenant.crm_relationship_edges SET from_entity_id=$1,updated_by=$2,updated_at=now()
     WHERE organization_id=$3 AND status='active' AND from_entity_type='party' AND from_entity_id=$4`,
    [survivorKey, context.userId, context.organizationId, sourceKey],
  );
  await client.query(
    `UPDATE tenant.crm_relationship_edges SET to_entity_id=$1,updated_by=$2,updated_at=now()
     WHERE organization_id=$3 AND status='active' AND to_entity_type='party' AND to_entity_id=$4`,
    [survivorKey, context.userId, context.organizationId, sourceKey],
  );
  await client.query(
    `UPDATE tenant.crm_relationship_edges SET status='inactive',updated_by=$1,updated_at=now()
     WHERE organization_id=$2 AND from_entity_type=to_entity_type AND from_entity_id=to_entity_id`,
    [context.userId, context.organizationId],
  );
  await client.query(
    `UPDATE tenant.business_parties
     SET status='inactive',privacy_status='restricted',parent_party_id=NULL,updated_by=$1,updated_at=now()
     WHERE organization_id=$2 AND id=$3`,
    [context.userId, context.organizationId, sourceKey],
  );
  const history = await client.query(
    `INSERT INTO tenant.crm_account_merge_history(
       organization_id,source_party_id,survivor_party_id,source_snapshot,survivor_snapshot,reason,merged_by
     ) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7) RETURNING *`,
    [
      context.organizationId,
      sourceKey,
      survivorKey,
      JSON.stringify(preview.source),
      JSON.stringify(preview.survivor),
      text(reason) || null,
      context.userId,
    ],
  );
  await client.query(
    `INSERT INTO tenant.crm_entity_merge_aliases(
       organization_id,entity_type,source_entity_id,survivor_entity_id,merge_history_id,merged_by
     ) VALUES($1,'account',$2,$3,$4,$5)
     ON CONFLICT (organization_id,entity_type,source_entity_id)
     DO UPDATE SET survivor_entity_id=EXCLUDED.survivor_entity_id,merge_history_id=EXCLUDED.merge_history_id,merged_by=EXCLUDED.merged_by,merged_at=now()`,
    [
      context.organizationId,
      sourceKey,
      survivorKey,
      history.rows[0].id,
      context.userId,
    ],
  );
  return { ...history.rows[0], moved };
}

export async function mergeContactsGoverned(
  client,
  context,
  sourceId,
  survivorId,
  reason = null,
) {
  const sourceKey = assertId(sourceId, "Source contact");
  const survivorKey = assertId(survivorId, "Surviving contact");
  if (sourceKey === survivorKey) {
    throw new CrmAccountIntelligenceError(
      400,
      "Choose two different contacts.",
    );
  }
  const ordered = [sourceKey, survivorKey].sort();
  await client.query(
    `SELECT id FROM tenant.contacts
     WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
    [context.organizationId, ordered],
  );
  const preview = await previewContactMerge(
    client,
    context,
    sourceKey,
    survivorKey,
  );
  if (
    preview.source.status !== "active" ||
    preview.survivor.status !== "active"
  ) {
    throw new CrmAccountIntelligenceError(
      409,
      "Both contacts must be active before merging.",
    );
  }
  const moved = await repointReferences(
    client,
    context,
    "contacts",
    sourceKey,
    survivorKey,
    new Set(["crm_contact_merge_history", "crm_entity_merge_aliases"]),
  );
  await client.query(
    `UPDATE tenant.crm_activities SET entity_id=$1,updated_at=now()
     WHERE organization_id=$2 AND entity_type='contact' AND entity_id=$3`,
    [survivorKey, context.organizationId, sourceKey],
  );
  await client.query(
    `UPDATE tenant.crm_relationship_edges
     SET status='inactive',updated_by=$1,updated_at=now()
     WHERE organization_id=$2 AND status='active'
       AND ((from_entity_type='contact' AND from_entity_id=$3 AND to_entity_type='contact' AND to_entity_id=$4)
         OR (to_entity_type='contact' AND to_entity_id=$3 AND from_entity_type='contact' AND from_entity_id=$4))`,
    [context.userId, context.organizationId, sourceKey, survivorKey],
  );
  await client.query(
    `UPDATE tenant.crm_relationship_edges SET from_entity_id=$1,updated_by=$2,updated_at=now()
     WHERE organization_id=$3 AND status='active' AND from_entity_type='contact' AND from_entity_id=$4`,
    [survivorKey, context.userId, context.organizationId, sourceKey],
  );
  await client.query(
    `UPDATE tenant.crm_relationship_edges SET to_entity_id=$1,updated_by=$2,updated_at=now()
     WHERE organization_id=$3 AND status='active' AND to_entity_type='contact' AND to_entity_id=$4`,
    [survivorKey, context.userId, context.organizationId, sourceKey],
  );
  await client.query(
    `UPDATE tenant.contacts
     SET status='inactive',privacy_status='restricted',is_primary=false,updated_by=$1,updated_at=now()
     WHERE organization_id=$2 AND id=$3`,
    [context.userId, context.organizationId, sourceKey],
  );
  const history = await client.query(
    `INSERT INTO tenant.crm_contact_merge_history(
       organization_id,source_contact_id,survivor_contact_id,source_snapshot,survivor_snapshot,reason,merged_by
     ) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7) RETURNING *`,
    [
      context.organizationId,
      sourceKey,
      survivorKey,
      JSON.stringify(preview.source),
      JSON.stringify(preview.survivor),
      text(reason) || null,
      context.userId,
    ],
  );
  await client.query(
    `INSERT INTO tenant.crm_entity_merge_aliases(
       organization_id,entity_type,source_entity_id,survivor_entity_id,merge_history_id,merged_by
     ) VALUES($1,'contact',$2,$3,$4,$5)
     ON CONFLICT (organization_id,entity_type,source_entity_id)
     DO UPDATE SET survivor_entity_id=EXCLUDED.survivor_entity_id,merge_history_id=EXCLUDED.merge_history_id,merged_by=EXCLUDED.merged_by,merged_at=now()`,
    [
      context.organizationId,
      sourceKey,
      survivorKey,
      history.rows[0].id,
      context.userId,
    ],
  );
  return { ...history.rows[0], moved };
}

export async function resolveMergedEntity(
  client,
  context,
  entityType,
  sourceId,
) {
  if (!new Set(["account", "contact"]).has(text(entityType))) {
    throw new CrmAccountIntelligenceError(400, "Entity type is unsupported.");
  }
  const result = await client.query(
    `SELECT * FROM tenant.crm_entity_merge_aliases
     WHERE organization_id=$1 AND entity_type=$2 AND source_entity_id=$3
     ORDER BY merged_at DESC LIMIT 1`,
    [context.organizationId, entityType, assertId(sourceId, "Source entity")],
  );
  return result.rows[0] || null;
}

export async function recordCustomerServiceEvent(
  client,
  context,
  partyId,
  input = {},
) {
  await account(client, context, partyId);
  const eventType = text(input.eventType || input.event_type || "service_note");
  if (
    !new Set([
      "case_opened",
      "case_updated",
      "case_resolved",
      "complaint",
      "service_note",
      "escalation",
    ]).has(eventType)
  ) {
    throw new CrmAccountIntelligenceError(
      400,
      "Service event type is invalid.",
    );
  }
  const title = text(input.title);
  if (!title) throw new CrmAccountIntelligenceError(400, "Title is required.");
  const result = await client.query(
    `INSERT INTO tenant.crm_customer_service_events(
       organization_id,company_id,party_id,contact_id,external_system,external_case_id,event_type,title,description,status,priority,occurred_at,metadata,created_by
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz,now()),$13::jsonb,$14)
     ON CONFLICT (organization_id,external_system,external_case_id)
     DO UPDATE SET event_type=EXCLUDED.event_type,title=EXCLUDED.title,description=EXCLUDED.description,status=EXCLUDED.status,priority=EXCLUDED.priority,occurred_at=EXCLUDED.occurred_at,metadata=EXCLUDED.metadata
     RETURNING *`,
    [
      context.organizationId,
      input.companyId || context.activeCompanyId || null,
      partyId,
      input.contactId || null,
      text(input.externalSystem || input.external_system || "manual"),
      text(input.externalCaseId || input.external_case_id) || null,
      eventType,
      title,
      text(input.description) || null,
      text(input.status || "open"),
      text(input.priority || "medium"),
      input.occurredAt || input.occurred_at || null,
      JSON.stringify(object(input.metadata)),
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function getCustomer360(client, context, partyId) {
  const party = await account(client, context, partyId);
  const hierarchy = await getAccountHierarchy(client, context, partyId);
  const contacts = await client.query(
    `SELECT * FROM tenant.contacts WHERE organization_id=$1 AND party_id=$2 ORDER BY is_primary DESC,status,first_name,last_name`,
    [context.organizationId, partyId],
  );
  const metrics = await client.query(
    `SELECT
       (SELECT count(*)::int FROM tenant.crm_opportunities WHERE organization_id=$1 AND party_id=$2) AS opportunities,
       (SELECT count(*)::int FROM tenant.sales_quotations WHERE organization_id=$1 AND party_id=$2) AS quotations,
       (SELECT count(*)::int FROM tenant.sales_orders WHERE organization_id=$1 AND party_id=$2) AS orders,
       (SELECT count(*)::int FROM tenant.accounting_customer_invoices WHERE organization_id=$1 AND party_id=$2) AS invoices,
       (SELECT COALESCE(sum(outstanding_amount),0) FROM tenant.accounting_customer_invoices WHERE organization_id=$1 AND party_id=$2 AND status NOT IN ('paid','cancelled','reversed')) AS outstanding,
       (SELECT count(*)::int FROM tenant.crm_customer_service_events WHERE organization_id=$1 AND party_id=$2 AND status NOT IN ('resolved','closed')) AS open_service_cases`,
    [context.organizationId, partyId],
  );
  const timeline = await client.query(
    `SELECT * FROM (
       SELECT 'activity'::text AS entry_type,activity.id AS entry_id,
              COALESCE(activity.completed_at,activity.start_at,activity.created_at) AS occurred_at,
              activity.subject AS title,activity.status,NULL::numeric AS amount,NULL::text AS currency_code,
              jsonb_build_object('activityType',activity.activity_type,'description',activity.description,'outcome',activity.outcome) AS details
       FROM tenant.crm_activities activity
       WHERE activity.organization_id=$1 AND (
         (activity.entity_type='party' AND activity.entity_id=$2) OR
         (activity.entity_type='contact' AND activity.entity_id IN (SELECT id FROM tenant.contacts WHERE organization_id=$1 AND party_id=$2))
       )
       UNION ALL
       SELECT 'communication',communication.id,communication.occurred_at,
              COALESCE(communication.subject,initcap(communication.channel)),communication.status,NULL,NULL,
              jsonb_build_object('channel',communication.channel,'direction',communication.direction,'provider',communication.provider)
       FROM tenant.crm_communications communication
       WHERE communication.organization_id=$1 AND (communication.party_id=$2 OR communication.contact_id IN (SELECT id FROM tenant.contacts WHERE organization_id=$1 AND party_id=$2))
       UNION ALL
       SELECT 'opportunity',opportunity.id,opportunity.created_at,opportunity.name,opportunity.status,opportunity.amount,opportunity.currency_code,
              jsonb_build_object('code',opportunity.code,'probability',opportunity.probability,'expectedCloseDate',opportunity.expected_close_date)
       FROM tenant.crm_opportunities opportunity WHERE opportunity.organization_id=$1 AND opportunity.party_id=$2
       UNION ALL
       SELECT 'quotation',quotation.id,quotation.created_at,quotation.quotation_number,quotation.lifecycle_status,version.grand_total,version.currency_code,
              jsonb_build_object('validUntil',quotation.valid_until,'acceptanceStatus',quotation.acceptance_status)
       FROM tenant.sales_quotations quotation
       LEFT JOIN tenant.sales_quotation_versions version ON version.organization_id=quotation.organization_id AND version.id=quotation.current_version_id
       WHERE quotation.organization_id=$1 AND quotation.party_id=$2
       UNION ALL
       SELECT 'sales_order',sales_order.id,sales_order.created_at,sales_order.sales_order_number,sales_order.lifecycle_status,version.grand_total,version.currency_code,
              jsonb_build_object('fulfillmentStatus',sales_order.fulfillment_status,'billingStatus',sales_order.billing_status)
       FROM tenant.sales_orders sales_order
       LEFT JOIN tenant.sales_order_versions version ON version.organization_id=sales_order.organization_id AND version.id=sales_order.current_version_id
       WHERE sales_order.organization_id=$1 AND sales_order.party_id=$2
       UNION ALL
       SELECT 'invoice',invoice.id,invoice.created_at,invoice.invoice_number,invoice.status,invoice.grand_total,invoice.currency_code,
              jsonb_build_object('invoiceDate',invoice.invoice_date,'dueDate',invoice.due_date,'outstandingAmount',invoice.outstanding_amount)
       FROM tenant.accounting_customer_invoices invoice WHERE invoice.organization_id=$1 AND invoice.party_id=$2
       UNION ALL
       SELECT 'receipt',receipt.id,receipt.created_at,receipt.receipt_number,receipt.status,receipt.amount,receipt.currency_code,
              jsonb_build_object('receiptDate',receipt.receipt_date,'unappliedAmount',receipt.unapplied_amount,'paymentMethod',receipt.payment_method)
       FROM tenant.accounting_customer_receipts receipt WHERE receipt.organization_id=$1 AND receipt.party_id=$2
       UNION ALL
       SELECT 'support',event.id,event.occurred_at,event.title,event.status,NULL,NULL,
              jsonb_build_object('eventType',event.event_type,'priority',event.priority,'externalSystem',event.external_system,'externalCaseId',event.external_case_id,'description',event.description)
       FROM tenant.crm_customer_service_events event WHERE event.organization_id=$1 AND event.party_id=$2
     ) timeline
     ORDER BY occurred_at DESC,entry_type,entry_id LIMIT 500`,
    [context.organizationId, partyId],
  );
  return {
    account: party,
    hierarchy,
    contacts: contacts.rows,
    metrics: metrics.rows[0] || {},
    timeline: timeline.rows,
    sourceCoverage: {
      crm: true,
      quotations: true,
      orders: true,
      invoices: true,
      support: true,
      supportMode: "governed service-event ingestion",
    },
  };
}

async function privacyRequest(client, context, requestId, lock = false) {
  const id = assertId(requestId, "Privacy request");
  const result = await client.query(
    `SELECT * FROM tenant.crm_privacy_requests
     WHERE organization_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
    [context.organizationId, id],
  );
  if (!result.rows[0]) {
    throw new CrmAccountIntelligenceError(
      404,
      "Privacy request not found.",
      "CRM_PRIVACY_REQUEST_NOT_FOUND",
    );
  }
  return result.rows[0];
}

async function privacySubject(
  client,
  context,
  subjectType,
  subjectId,
  lock = false,
) {
  const id = assertId(subjectId, "Privacy subject");
  const config = {
    lead: { table: "crm_leads", label: "Lead" },
    contact: { table: "contacts", label: "Contact" },
    party: { table: "business_parties", label: "Account" },
  }[subjectType];
  if (!config)
    throw new CrmAccountIntelligenceError(400, "Subject type is invalid.");
  const result = await client.query(
    `SELECT * FROM tenant.${config.table}
     WHERE organization_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
    [context.organizationId, id],
  );
  if (!result.rows[0]) {
    throw new CrmAccountIntelligenceError(404, `${config.label} not found.`);
  }
  return result.rows[0];
}

async function privacyCounts(client, context, subjectType, subjectId) {
  if (subjectType === "lead") {
    const result = await client.query(
      `SELECT
        (SELECT count(*)::int FROM tenant.crm_activities WHERE organization_id=$1 AND entity_type='lead' AND entity_id=$2) AS activities,
        (SELECT count(*)::int FROM tenant.crm_communications WHERE organization_id=$1 AND lead_id=$2) AS communications,
        (SELECT count(*)::int FROM tenant.crm_notes WHERE organization_id=$1 AND entity_type='lead' AND entity_id=$2) AS notes`,
      [context.organizationId, subjectId],
    );
    return result.rows[0];
  }
  if (subjectType === "contact") {
    const result = await client.query(
      `SELECT
        (SELECT count(*)::int FROM tenant.crm_activities WHERE organization_id=$1 AND entity_type='contact' AND entity_id=$2) AS activities,
        (SELECT count(*)::int FROM tenant.crm_communications WHERE organization_id=$1 AND contact_id=$2) AS communications,
        (SELECT count(*)::int FROM tenant.crm_opportunities WHERE organization_id=$1 AND contact_id=$2) AS opportunities`,
      [context.organizationId, subjectId],
    );
    return result.rows[0];
  }
  const result = await client.query(
    `SELECT
      (SELECT count(*)::int FROM tenant.contacts WHERE organization_id=$1 AND party_id=$2) AS contacts,
      (SELECT count(*)::int FROM tenant.addresses WHERE organization_id=$1 AND party_id=$2) AS addresses,
      (SELECT count(*)::int FROM tenant.crm_opportunities WHERE organization_id=$1 AND party_id=$2) AS opportunities,
      (SELECT count(*)::int FROM tenant.sales_orders WHERE organization_id=$1 AND party_id=$2) AS orders,
      (SELECT count(*)::int FROM tenant.accounting_customer_invoices WHERE organization_id=$1 AND party_id=$2) AS invoices`,
    [context.organizationId, subjectId],
  );
  return result.rows[0];
}

export async function previewPrivacyRequest(client, context, requestId) {
  const request = await privacyRequest(client, context, requestId);
  const subject = await privacySubject(
    client,
    context,
    request.subject_type,
    request.subject_id,
  );
  const counts = await privacyCounts(
    client,
    context,
    request.subject_type,
    request.subject_id,
  );
  return {
    request,
    subject,
    counts,
    ready:
      Boolean(request.identity_verified_at) &&
      !["completed", "rejected", "cancelled"].includes(request.status) &&
      !Boolean(subject.legal_hold),
    blockers: [
      ...(!request.identity_verified_at
        ? ["Identity verification is required."]
        : []),
      ...(["completed", "rejected", "cancelled"].includes(request.status)
        ? [`Request is already ${request.status}.`]
        : []),
      ...(subject.legal_hold ? ["The subject is under legal hold."] : []),
    ],
  };
}

async function anonymizeSubject(client, context, subjectType, subjectId) {
  const suffix = subjectId.slice(0, 8);
  if (subjectType === "lead") {
    await client.query(
      `UPDATE tenant.crm_leads SET
         first_name=$1,last_name=NULL,email=NULL,phone=NULL,mobile=NULL,company_name=NULL,job_title=NULL,website=NULL,
         city=NULL,state=NULL,country_code=NULL,product_interest=NULL,consent_email=false,consent_sms=false,consent_whatsapp=false,
         do_not_contact=true,record_status='archived',privacy_status='anonymized',anonymized_at=now(),updated_by=$2,updated_at=now(),
         custom_data=jsonb_build_object('privacyAnonymized',true,'anonymizedAt',now())
       WHERE organization_id=$3 AND id=$4`,
      [
        `Anonymized ${suffix}`,
        context.userId,
        context.organizationId,
        subjectId,
      ],
    );
    await client.query(
      `UPDATE tenant.crm_communications SET subject='Redacted',body='[redacted by privacy execution]',from_address=NULL,to_addresses=ARRAY[]::text[],metadata=metadata || '{"privacyRedacted":true}'::jsonb,updated_by=$1,updated_at=now()
       WHERE organization_id=$2 AND lead_id=$3`,
      [context.userId, context.organizationId, subjectId],
    );
    await client.query(
      `UPDATE tenant.crm_notes SET body='[redacted by privacy execution]',updated_at=now()
       WHERE organization_id=$1 AND entity_type='lead' AND entity_id=$2`,
      [context.organizationId, subjectId],
    );
  } else if (subjectType === "contact") {
    await client.query(
      `UPDATE tenant.contacts SET first_name=$1,last_name=NULL,designation=NULL,email=NULL,phone=NULL,mobile=NULL,is_primary=false,status='inactive',privacy_status='anonymized',anonymized_at=now(),updated_by=$2,updated_at=now()
       WHERE organization_id=$3 AND id=$4`,
      [
        `Anonymized ${suffix}`,
        context.userId,
        context.organizationId,
        subjectId,
      ],
    );
    await client.query(
      `UPDATE tenant.crm_communications SET subject='Redacted',body='[redacted by privacy execution]',from_address=NULL,to_addresses=ARRAY[]::text[],metadata=metadata || '{"privacyRedacted":true}'::jsonb,updated_by=$1,updated_at=now()
       WHERE organization_id=$2 AND contact_id=$3`,
      [context.userId, context.organizationId, subjectId],
    );
  } else {
    await client.query(
      `UPDATE tenant.business_parties SET display_name=$1,legal_name=NULL,gstin=NULL,pan=NULL,msme_number=NULL,status='inactive',privacy_status='anonymized',anonymized_at=now(),updated_by=$2,updated_at=now()
       WHERE organization_id=$3 AND id=$4`,
      [
        `Anonymized account ${suffix}`,
        context.userId,
        context.organizationId,
        subjectId,
      ],
    );
    await client.query(
      `UPDATE tenant.addresses SET line1='[redacted]',line2=NULL,city='[redacted]',district=NULL,state='[redacted]',state_code=NULL,postal_code='000000',gstin=NULL,status='inactive',updated_by=$1,updated_at=now()
       WHERE organization_id=$2 AND party_id=$3`,
      [context.userId, context.organizationId, subjectId],
    );
    await client.query(
      `UPDATE tenant.contacts SET first_name='Anonymized',last_name=NULL,designation=NULL,email=NULL,phone=NULL,mobile=NULL,is_primary=false,status='inactive',privacy_status='anonymized',anonymized_at=now(),updated_by=$1,updated_at=now()
       WHERE organization_id=$2 AND party_id=$3`,
      [context.userId, context.organizationId, subjectId],
    );
    await client.query(
      `UPDATE tenant.crm_communications SET subject='Redacted',body='[redacted by privacy execution]',from_address=NULL,to_addresses=ARRAY[]::text[],metadata=metadata || '{"privacyRedacted":true}'::jsonb,updated_by=$1,updated_at=now()
       WHERE organization_id=$2 AND party_id=$3`,
      [context.userId, context.organizationId, subjectId],
    );
  }
}

async function eraseSubject(client, context, subjectType, subjectId) {
  await anonymizeSubject(client, context, subjectType, subjectId);
  const table =
    subjectType === "lead"
      ? "crm_leads"
      : subjectType === "contact"
        ? "contacts"
        : "business_parties";
  await client.query(
    `UPDATE tenant.${table}
     SET privacy_status='erased',updated_by=$1,updated_at=now()
     WHERE organization_id=$2 AND id=$3`,
    [context.userId, context.organizationId, subjectId],
  );
  if (subjectType === "party") {
    await client.query(
      `UPDATE tenant.contacts
       SET privacy_status='erased',updated_by=$1,updated_at=now()
       WHERE organization_id=$2 AND party_id=$3`,
      [context.userId, context.organizationId, subjectId],
    );
  }
}

async function restrictSubject(client, context, subjectType, subjectId) {
  const table =
    subjectType === "lead"
      ? "crm_leads"
      : subjectType === "contact"
        ? "contacts"
        : "business_parties";
  await client.query(
    `UPDATE tenant.${table} SET privacy_status='restricted',updated_by=$1,updated_at=now() WHERE organization_id=$2 AND id=$3`,
    [context.userId, context.organizationId, subjectId],
  );
  if (subjectType === "lead") {
    await client.query(
      `UPDATE tenant.crm_leads SET do_not_contact=true,consent_email=false,consent_sms=false,consent_whatsapp=false WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, subjectId],
    );
  }
}

async function correctSubject(
  client,
  context,
  subjectType,
  subjectId,
  corrections,
) {
  const allowed = {
    lead: new Set([
      "firstName",
      "lastName",
      "email",
      "phone",
      "mobile",
      "companyName",
      "jobTitle",
    ]),
    contact: new Set([
      "firstName",
      "lastName",
      "email",
      "phone",
      "mobile",
      "designation",
    ]),
    party: new Set(["displayName", "legalName", "gstin", "pan"]),
  }[subjectType];
  const columns = {
    firstName: "first_name",
    lastName: "last_name",
    companyName: "company_name",
    jobTitle: "job_title",
    displayName: "display_name",
    legalName: "legal_name",
    email: "email",
    phone: "phone",
    mobile: "mobile",
    designation: "designation",
    gstin: "gstin",
    pan: "pan",
  };
  const entries = Object.entries(object(corrections)).filter(([key]) =>
    allowed.has(key),
  );
  if (!entries.length) {
    throw new CrmAccountIntelligenceError(
      400,
      "At least one supported correction is required.",
    );
  }
  const table =
    subjectType === "lead"
      ? "crm_leads"
      : subjectType === "contact"
        ? "contacts"
        : "business_parties";
  const values = [context.userId, context.organizationId, subjectId];
  const updates = entries.map(([key, value], index) => {
    values.push(value === "" ? null : value);
    return `${columns[key]}=$${index + 4}`;
  });
  await client.query(
    `UPDATE tenant.${table} SET ${updates.join(",")},updated_by=$1,updated_at=now() WHERE organization_id=$2 AND id=$3`,
    values,
  );
}

export async function executePrivacyRequest(
  client,
  context,
  requestId,
  input = {},
) {
  const preview = await previewPrivacyRequest(client, context, requestId);
  const request = await privacyRequest(client, context, requestId, true);
  const subject = await privacySubject(
    client,
    context,
    request.subject_type,
    request.subject_id,
    true,
  );
  if (!preview.ready) {
    throw new CrmAccountIntelligenceError(
      409,
      preview.blockers.join(" ") || "Privacy request is not ready.",
      "CRM_PRIVACY_EXECUTION_BLOCKED",
    );
  }
  let operation = request.request_type;
  let exportPayload = null;
  if (["access", "export"].includes(request.request_type)) {
    operation = request.request_type;
    exportPayload = {
      subject,
      counts: preview.counts,
      generatedAt: new Date().toISOString(),
    };
  } else if (request.request_type === "correction") {
    operation = "correction";
    await correctSubject(
      client,
      context,
      request.subject_type,
      request.subject_id,
      input.corrections,
    );
  } else if (request.request_type === "deletion") {
    const erasureMode = text(
      input.erasureMode || input.erasure_mode || "anonymize",
    );
    if (!new Set(["anonymize", "erase"]).has(erasureMode)) {
      throw new CrmAccountIntelligenceError(
        400,
        "Deletion mode must be anonymize or erase.",
        "CRM_PRIVACY_ERASURE_MODE_INVALID",
      );
    }
    operation = erasureMode;
    if (erasureMode === "erase") {
      await eraseSubject(
        client,
        context,
        request.subject_type,
        request.subject_id,
      );
    } else {
      await anonymizeSubject(
        client,
        context,
        request.subject_type,
        request.subject_id,
      );
    }
  } else {
    operation =
      request.request_type === "consent_withdrawal"
        ? "consent_withdrawal"
        : "restrict";
    await restrictSubject(
      client,
      context,
      request.subject_type,
      request.subject_id,
    );
  }
  const resultSummary = {
    requestType: request.request_type,
    subjectType: request.subject_type,
    subjectId: request.subject_id,
    counts: preview.counts,
    operation,
    exported: Boolean(exportPayload),
  };
  const hash = crmAccountIntelligenceHash({ resultSummary, exportPayload });
  const run = await client.query(
    `INSERT INTO tenant.crm_privacy_execution_runs(
       organization_id,privacy_request_id,subject_type,subject_id,operation,status,result_summary,content_hash,executed_by
     ) VALUES($1,$2,$3,$4,$5,'completed',$6::jsonb,$7,$8) RETURNING *`,
    [
      context.organizationId,
      request.id,
      request.subject_type,
      request.subject_id,
      operation,
      JSON.stringify(resultSummary),
      hash,
      context.userId,
    ],
  );
  await client.query(
    `UPDATE tenant.crm_privacy_requests
     SET status='completed',resolution_notes=$1,completed_at=now(),updated_by=$2,updated_at=now()
     WHERE organization_id=$3 AND id=$4`,
    [
      text(input.resolutionNotes || input.resolution_notes) ||
        `Executed ${operation} through governed CRM privacy workflow.`,
      context.userId,
      context.organizationId,
      request.id,
    ],
  );
  return { run: run.rows[0], exportPayload };
}

export async function getPrivacyRetentionDashboard(client, context) {
  const [policies, runs] = await Promise.all([
    client.query(
      `SELECT * FROM tenant.crm_privacy_retention_policies
       WHERE organization_id=$1 ORDER BY subject_type,name`,
      [context.organizationId],
    ),
    client.query(
      `SELECT * FROM tenant.crm_privacy_execution_runs
       WHERE organization_id=$1 ORDER BY executed_at DESC LIMIT 100`,
      [context.organizationId],
    ),
  ]);
  return {
    policies: policies.rows,
    runs: runs.rows,
    metrics: {
      activePolicies: policies.rows.filter((row) => row.status === "active")
        .length,
      completedRuns: runs.rows.filter((row) => row.status === "completed")
        .length,
      failedRuns: runs.rows.filter((row) => row.status === "failed").length,
    },
  };
}

export async function updatePrivacyRetentionPolicy(
  client,
  context,
  policyId,
  input = {},
) {
  const id = assertId(policyId, "Retention policy");
  const current = await client.query(
    `SELECT * FROM tenant.crm_privacy_retention_policies
     WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, id],
  );
  if (!current.rows[0]) {
    throw new CrmAccountIntelligenceError(404, "Retention policy not found.");
  }
  const status = text(input.status || current.rows[0].status);
  const action = text(input.action || current.rows[0].action);
  const retentionDays = Number(
    input.retentionDays ||
      input.retention_days ||
      current.rows[0].retention_days,
  );
  if (!new Set(["active", "inactive"]).has(status)) {
    throw new CrmAccountIntelligenceError(
      400,
      "Retention policy status is invalid.",
    );
  }
  if (!new Set(["restrict", "anonymize"]).has(action)) {
    throw new CrmAccountIntelligenceError(
      400,
      "Retention policy action is invalid.",
    );
  }
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < 1 ||
    retentionDays > 36500
  ) {
    throw new CrmAccountIntelligenceError(
      400,
      "Retention days must be between 1 and 36500.",
    );
  }
  const result = await client.query(
    `UPDATE tenant.crm_privacy_retention_policies
     SET name=$1,retention_days=$2,action=$3,status=$4,updated_by=$5,updated_at=now()
     WHERE organization_id=$6 AND id=$7 RETURNING *`,
    [
      text(input.name || current.rows[0].name),
      retentionDays,
      action,
      status,
      context.userId,
      context.organizationId,
      id,
    ],
  );
  return result.rows[0];
}

export async function runPrivacyRetention(client, context, input = {}) {
  const limit = Math.max(1, Math.min(200, Number(input.limit || 50)));
  const policies = await client.query(
    `SELECT * FROM tenant.crm_privacy_retention_policies
     WHERE organization_id=$1 AND status='active' ORDER BY subject_type,name`,
    [context.organizationId],
  );
  const results = [];
  for (const policy of policies.rows) {
    const table =
      policy.subject_type === "lead"
        ? "crm_leads"
        : policy.subject_type === "contact"
          ? "contacts"
          : "business_parties";
    const inactiveStatus =
      policy.subject_type === "lead" ? "archived" : "inactive";
    const candidates = await client.query(
      `SELECT id FROM tenant.${table}
       WHERE organization_id=$1 AND legal_hold=false AND privacy_status='active'
         AND (retention_until<=now() OR (status=$2 AND updated_at<=now()-($3::int || ' days')::interval))
       ORDER BY COALESCE(retention_until,updated_at) LIMIT $4 FOR UPDATE SKIP LOCKED`,
      [context.organizationId, inactiveStatus, policy.retention_days, limit],
    );
    for (const candidate of candidates.rows) {
      if (policy.action === "anonymize") {
        await anonymizeSubject(
          client,
          context,
          policy.subject_type,
          candidate.id,
        );
      } else {
        await restrictSubject(
          client,
          context,
          policy.subject_type,
          candidate.id,
        );
      }
      const summary = {
        automated: true,
        policyId: policy.id,
        policyName: policy.name,
        retentionDays: policy.retention_days,
      };
      const run = await client.query(
        `INSERT INTO tenant.crm_privacy_execution_runs(
           organization_id,policy_id,subject_type,subject_id,operation,status,result_summary,content_hash,executed_by
         ) VALUES($1,$2,$3,$4,$5,'completed',$6::jsonb,$7,$8) RETURNING *`,
        [
          context.organizationId,
          policy.id,
          policy.subject_type,
          candidate.id,
          policy.action,
          JSON.stringify(summary),
          crmAccountIntelligenceHash({
            policyId: policy.id,
            subjectId: candidate.id,
            action: policy.action,
          }),
          context.userId,
        ],
      );
      results.push(run.rows[0]);
    }
    await client.query(
      `UPDATE tenant.crm_privacy_retention_policies SET last_run_at=now(),updated_by=$1,updated_at=now() WHERE organization_id=$2 AND id=$3`,
      [context.userId, context.organizationId, policy.id],
    );
  }
  return {
    policies: policies.rows.length,
    processed: results.length,
    runs: results,
  };
}

export async function recordCrmAccountIntelligenceAcceptance(
  client,
  context,
  input = {},
) {
  const capabilityId = text(input.capabilityId || input.capability_id);
  if (!CRM_ACCOUNT_INTELLIGENCE_CAPABILITY_IDS.includes(capabilityId)) {
    throw new CrmAccountIntelligenceError(400, "Capability ID is unsupported.");
  }
  const status = text(input.status || "passed");
  if (!new Set(["passed", "failed"]).has(status)) {
    throw new CrmAccountIntelligenceError(400, "Acceptance status is invalid.");
  }
  const evidence = object(input.evidence);
  const result = await client.query(
    `INSERT INTO tenant.crm_account_intelligence_acceptance_runs(
       organization_id,capability_id,status,evidence,content_hash,commit_sha,recorded_by
     ) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7) RETURNING *`,
    [
      context.organizationId,
      capabilityId,
      status,
      JSON.stringify(evidence),
      crmAccountIntelligenceHash({ capabilityId, status, evidence }),
      text(input.commitSha || input.commit_sha) || null,
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function getCrmAccountIntelligenceReadiness(client, context) {
  const result = await client.query(
    `SELECT DISTINCT ON (capability_id) *
     FROM tenant.crm_account_intelligence_acceptance_runs
     WHERE organization_id=$1
     ORDER BY capability_id,recorded_at DESC`,
    [context.organizationId],
  );
  const byId = new Map(result.rows.map((row) => [row.capability_id, row]));
  const checks = CRM_ACCOUNT_INTELLIGENCE_CAPABILITY_IDS.map(
    (capabilityId) => ({
      capabilityId,
      status: byId.get(capabilityId)?.status || "missing",
      evidence: byId.get(capabilityId)?.evidence || {},
      recordedAt: byId.get(capabilityId)?.recorded_at || null,
    }),
  );
  const blockers = checks
    .filter((check) => check.status !== "passed")
    .map((check) => `${check.capabilityId} has not passed acceptance.`);
  return {
    readiness: blockers.length ? "blocked" : "ready",
    score: Math.round(
      (checks.filter((check) => check.status === "passed").length /
        checks.length) *
        100,
    ),
    blockers,
    checks,
  };
}
