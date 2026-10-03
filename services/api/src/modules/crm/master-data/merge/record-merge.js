// F002/F003/F008 governed Account and Contact merge: survivorship field rules
// ("source"/"survivor" choices only, values re-derived server-side,
// sensitive fields gated), previews, scope checks, foreign-key repointing
// discovered from pg_constraint, relationship reconciliation, merge history
// and merge aliases. One engine for both record types.

import { canViewAllCrmRecords } from "../../data-management/crm-access-scope.js";
import { crmChildScopes } from "../../data-management/record-policy.js";
import { CrmAccountIntelligenceError, assertId } from "../account-intelligence-error.js";
import { canViewSensitiveAccountContent, projectAccountForContext } from "../account-security.js";
import { reconcileRelationshipsOnAccountMerge, reconcileRelationshipsOnContactMerge } from "../contact-relationships.js";
import { canViewSensitiveContactContent, projectContactForContext } from "../contact-security.js";
import { loadScopedAccount, loadScopedContact } from "../record-access.js";

const text = (value) => String(value ?? "").trim();

// F008/CRM-VNEXT-086 merge survivorship: the fixed, code-reviewed set of
// fields a merge UI may offer a choice on. Deliberately narrow — system
// fields (id, organization_id, status, code, party_id,
// parent_party_id, timestamps, created_by) are never selectable; they
// follow the merge engine's own deterministic rules (parent_party_id via
// reparenting, party_id via the relationship-reconciliation module, status
// via the deactivation step below) rather than an arbitrary UI choice.
// "Owner" is not listed for either entity: unlike Lead, current Account/
// Contact schema has no owner_user_id column to select between.
const ACCOUNT_SURVIVOR_FIELDS = Object.freeze([
  "display_name",
  "legal_name",
  "industry",
  "website",
  "phone",
  "email",
  "currency_code",
]);
const ACCOUNT_SENSITIVE_SURVIVOR_FIELDS = Object.freeze(["gstin", "pan", "msme_number"]);
const CONTACT_SURVIVOR_FIELDS = Object.freeze([
  "first_name",
  "last_name",
  "designation",
  "preferred_language",
  "timezone",
]);
const CONTACT_SENSITIVE_SURVIVOR_FIELDS = Object.freeze(["email", "phone", "mobile"]);

function buildFieldComparison(sourceRow, survivorRow, plainFields, sensitiveFields, canViewSensitive) {
  const comparison = [];
  for (const field of plainFields) {
    const sourceValue = sourceRow[field] ?? null;
    const survivorValue = survivorRow[field] ?? null;
    comparison.push({
      field,
      sourceValue,
      survivorValue,
      conflict: sourceValue !== survivorValue,
      sensitive: false,
      selectable: true,
    });
  }
  for (const field of sensitiveFields) {
    if (!canViewSensitive) continue; // never expose a sensitive field's values to an unauthorized comparer
    const sourceValue = sourceRow[field] ?? null;
    const survivorValue = survivorRow[field] ?? null;
    comparison.push({
      field,
      sourceValue,
      survivorValue,
      conflict: sourceValue !== survivorValue,
      sensitive: true,
      selectable: true,
    });
  }
  return comparison;
}

// Never trusts a client-supplied raw value — a selection is only ever
// "source" or "survivor", and this function re-derives the actual value
// server-side from the two freshly-fetched records, so a selected value can
// never be anything other than one of the two real candidate values.
function resolveFieldSelections(sourceRow, survivorRow, plainFields, sensitiveFields, canViewSensitive, selections) {
  const applied = {};
  const resolvedValues = {};
  if (!selections || typeof selections !== "object") return { applied, resolvedValues };
  const allowed = new Set(plainFields);
  const sensitiveAllowed = new Set(sensitiveFields);
  for (const [field, choice] of Object.entries(selections)) {
    if (choice !== "source" && choice !== "survivor") {
      throw new CrmAccountIntelligenceError(
        400,
        `Invalid selection for field "${field}" — choose "source" or "survivor".`,
        "CRM_MERGE_SELECTION_INVALID",
      );
    }
    const isSensitive = sensitiveAllowed.has(field);
    if (!allowed.has(field) && !isSensitive) {
      throw new CrmAccountIntelligenceError(
        400,
        `Field "${field}" is not eligible for merge survivorship selection.`,
        "CRM_MERGE_FIELD_NOT_SELECTABLE",
      );
    }
    if (isSensitive && !canViewSensitive) {
      throw new CrmAccountIntelligenceError(
        403,
        `You do not have permission to select a value for the sensitive field "${field}".`,
        "CRM_MERGE_SENSITIVE_FIELD_FORBIDDEN",
      );
    }
    if (choice === "source") {
      applied[field] = sourceRow[field] ?? null;
      resolvedValues[field] = "source";
    }
    // "survivor" selections need no write — the survivor's own value is
    // already what's on the row; recording it keeps the audit trail
    // complete (the user *did* make a choice) without an unnecessary UPDATE.
    resolvedValues[field] = choice;
  }
  return { applied, resolvedValues };
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

// Merge moves EVERY child record of the source to the survivor and the
// preview counts them all, so a caller without crm.records.view_all may only
// merge when every Opportunity and Activity on the source is inside their
// own scope (own/team/unassigned). Otherwise it would re-parent — and reveal
// the existence of — records they cannot see. Scoped count vs total, in SQL.
async function assertMergeChildrenInScope(client, context, kind, sourceId) {
  if (canViewAllCrmRecords(context)) return;
  const opportunityColumn = kind === "account" ? "party_id" : "contact_id";
  const entityType = kind === "account" ? "party" : "contact";
  const parameters = [context.organizationId, sourceId, entityType];
  const scope = crmChildScopes(context, parameters);
  const result = await client.query(
    `SELECT
       (SELECT count(*)::int FROM tenant.crm_opportunities opportunity WHERE opportunity.organization_id=$1 AND opportunity.${opportunityColumn}=$2)
     - (SELECT count(*)::int FROM tenant.crm_opportunities opportunity WHERE opportunity.organization_id=$1 AND opportunity.${opportunityColumn}=$2${scope.opportunity()})
     + (SELECT count(*)::int FROM tenant.crm_activities activity WHERE activity.organization_id=$1 AND activity.entity_type=$3 AND activity.entity_id=$2)
     - (SELECT count(*)::int FROM tenant.crm_activities activity WHERE activity.organization_id=$1 AND activity.entity_type=$3 AND activity.entity_id=$2${scope.activity()}) AS hidden`,
    parameters,
  );
  if (Number(result.rows[0]?.hidden || 0) > 0)
    throw new CrmAccountIntelligenceError(
      403,
      `This ${kind} has opportunities or activities outside your access. Ask someone who can see all CRM records to merge it.`,
      "CRM_MERGE_OUT_OF_SCOPE",
    );
}

export async function previewAccountMerge(
  client,
  context,
  sourceId,
  survivorId,
) {
  const source = await loadScopedAccount(client, context, sourceId);
  const survivor = await loadScopedAccount(client, context, survivorId);
  if (source.id === survivor.id) {
    throw new CrmAccountIntelligenceError(
      400,
      "Choose two different accounts.",
    );
  }
  await assertMergeChildrenInScope(client, context, "account", source.id);
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
  const canViewSensitive = canViewSensitiveAccountContent(context);
  const fieldComparison = buildFieldComparison(
    source,
    survivor,
    ACCOUNT_SURVIVOR_FIELDS,
    ACCOUNT_SENSITIVE_SURVIVOR_FIELDS,
    canViewSensitive,
  );
  // source/survivor here stay RAW (unprojected) — mergeAccountsGoverned
  // uses this internally to write the permanent merge_history snapshot,
  // which must stay complete regardless of the acting user's own view
  // permissions (audit completeness, not user-facing display). API routes
  // that expose this preview to a browser MUST call
  // previewAccountMergeForCaller instead — see below.
  return { source, survivor, impact, fieldComparison };
}

// The safe, API-facing variant — same CRM-VNEXT-085 concern as
// getCrmAccountForCaller: never return the raw source/survivor records to a
// caller without sensitive access. fieldComparison is already filtered by
// previewAccountMerge itself.
export async function previewAccountMergeForCaller(client, context, sourceId, survivorId) {
  const preview = await previewAccountMerge(client, context, sourceId, survivorId);
  return {
    ...preview,
    source: projectAccountForContext(context, preview.source),
    survivor: projectAccountForContext(context, preview.survivor),
  };
}

export async function previewContactMerge(
  client,
  context,
  sourceId,
  survivorId,
) {
  const source = await loadScopedContact(client, context, sourceId);
  const survivor = await loadScopedContact(client, context, survivorId);
  if (source.id === survivor.id) {
    throw new CrmAccountIntelligenceError(
      400,
      "Choose two different contacts.",
    );
  }
  await assertMergeChildrenInScope(client, context, "contact", source.id);
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
  const canViewSensitive = canViewSensitiveContactContent(context);
  const fieldComparison = buildFieldComparison(
    source,
    survivor,
    CONTACT_SURVIVOR_FIELDS,
    CONTACT_SENSITIVE_SURVIVOR_FIELDS,
    canViewSensitive,
  );
  // Same reasoning as previewAccountMerge: stays RAW for the internal
  // merge_history snapshot; API routes must use previewContactMergeForCaller.
  return { source, survivor, impact, fieldComparison };
}

export async function previewContactMergeForCaller(client, context, sourceId, survivorId) {
  const preview = await previewContactMerge(client, context, sourceId, survivorId);
  return {
    ...preview,
    source: projectContactForContext(context, preview.source),
    survivor: projectContactForContext(context, preview.survivor),
  };
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
  options = {},
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
  // Optimistic concurrency: the client fetched a comparison, a human
  // reviewed it, then confirmed — if either record changed in between (the
  // row was locked FOR UPDATE above, so this compares against the
  // now-guaranteed-current state), the review is stale and must not be
  // silently applied against outdated data.
  if (
    (options.expectedSourceUpdatedAt &&
      new Date(preview.source.updated_at).getTime() !== new Date(options.expectedSourceUpdatedAt).getTime()) ||
    (options.expectedSurvivorUpdatedAt &&
      new Date(preview.survivor.updated_at).getTime() !== new Date(options.expectedSurvivorUpdatedAt).getTime())
  ) {
    throw new CrmAccountIntelligenceError(
      409,
      "This record changed while you were reviewing the merge. Refresh the comparison before continuing.",
      "CRM_MERGE_COMPARISON_STALE",
    );
  }
  const canViewSensitive = canViewSensitiveAccountContent(context);
  const { applied: survivorshipUpdates, resolvedValues: fieldSelections } = resolveFieldSelections(
    preview.source,
    preview.survivor,
    ACCOUNT_SURVIVOR_FIELDS,
    ACCOUNT_SENSITIVE_SURVIVOR_FIELDS,
    canViewSensitive,
    options.fieldSelections,
  );
  await assertAccountMergeHierarchySafe(
    client,
    context,
    sourceKey,
    survivorKey,
  );
  if (Object.keys(survivorshipUpdates).length) {
    const setParameters = [context.organizationId, survivorKey, context.userId];
    const assignments = Object.entries(survivorshipUpdates).map(([field, value]) => {
      setParameters.push(value);
      return `${quoteIdentifier(field)}=$${setParameters.length}`;
    });
    await client.query(
      `UPDATE tenant.business_parties SET ${assignments.join(",")},updated_by=$3,updated_at=now()
       WHERE organization_id=$1 AND id=$2`,
      setParameters,
    );
  }
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
  // Reconciled explicitly (dedup + repoint), not by the generic pass below:
  // a blind repoint here could try to UPDATE a source relationship row onto
  // an Account+Contact pair the survivor already has, violating the
  // (organization_id, contact_id, party_id) unique constraint.
  await reconcileRelationshipsOnAccountMerge(client, context, sourceKey, survivorKey);
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
      "crm_contact_account_relationships",
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
       organization_id,source_party_id,survivor_party_id,source_snapshot,survivor_snapshot,reason,merged_by,field_selections
     ) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8::jsonb) RETURNING *`,
    [
      context.organizationId,
      sourceKey,
      survivorKey,
      JSON.stringify(preview.source),
      JSON.stringify(preview.survivor),
      text(reason) || null,
      context.userId,
      JSON.stringify(fieldSelections),
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
  options = {},
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
  if (
    (options.expectedSourceUpdatedAt &&
      new Date(preview.source.updated_at).getTime() !== new Date(options.expectedSourceUpdatedAt).getTime()) ||
    (options.expectedSurvivorUpdatedAt &&
      new Date(preview.survivor.updated_at).getTime() !== new Date(options.expectedSurvivorUpdatedAt).getTime())
  ) {
    throw new CrmAccountIntelligenceError(
      409,
      "This record changed while you were reviewing the merge. Refresh the comparison before continuing.",
      "CRM_MERGE_COMPARISON_STALE",
    );
  }
  const canViewSensitive = canViewSensitiveContactContent(context);
  const { applied: survivorshipUpdates, resolvedValues: fieldSelections } = resolveFieldSelections(
    preview.source,
    preview.survivor,
    CONTACT_SURVIVOR_FIELDS,
    CONTACT_SENSITIVE_SURVIVOR_FIELDS,
    canViewSensitive,
    options.fieldSelections,
  );
  if (Object.keys(survivorshipUpdates).length) {
    const setParameters = [context.organizationId, survivorKey, context.userId];
    const assignments = Object.entries(survivorshipUpdates).map(([field, value]) => {
      setParameters.push(value);
      return `${quoteIdentifier(field)}=$${setParameters.length}`;
    });
    await client.query(
      `UPDATE tenant.contacts SET ${assignments.join(",")},updated_by=$3,updated_at=now()
       WHERE organization_id=$1 AND id=$2`,
      setParameters,
    );
  }
  // Same reasoning as the Account merge above: reconciled explicitly to
  // avoid a unique-constraint collision on (contact_id, party_id).
  await reconcileRelationshipsOnContactMerge(client, context, sourceKey, survivorKey);
  const moved = await repointReferences(
    client,
    context,
    "contacts",
    sourceKey,
    survivorKey,
    new Set([
      "crm_contact_merge_history",
      "crm_entity_merge_aliases",
      "crm_contact_account_relationships",
    ]),
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
       organization_id,source_contact_id,survivor_contact_id,source_snapshot,survivor_snapshot,reason,merged_by,field_selections
     ) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8::jsonb) RETURNING *`,
    [
      context.organizationId,
      sourceKey,
      survivorKey,
      JSON.stringify(preview.source),
      JSON.stringify(preview.survivor),
      text(reason) || null,
      context.userId,
      JSON.stringify(fieldSelections),
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
