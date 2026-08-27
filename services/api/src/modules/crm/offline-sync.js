import { createHash, randomUUID } from "node:crypto";
import { createCrmRecord } from "./index.js";
export const CRM_OFFLINE_CAPABILITY_IDS = Object.freeze(["CRM-072"]);
export class CrmOfflineSyncError extends Error {
  constructor(status, message, code = "CRM_OFFLINE_SYNC_ERROR", details = []) {
    super(message);
    this.name = "CrmOfflineSyncError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const text = (v) => String(v ?? "").trim();
const number = (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);
const array = (v) => (Array.isArray(v) ? v : []);
const object = (v) =>
  v && typeof v === "object" && !Array.isArray(v) ? v : {};
export function crmOfflineHash(value) {
  const stable = (v) =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, stable(v[k])]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}
export function createOfflineMutationId(input = {}) {
  const key = text(input.idempotencyKey || input.idempotency_key);
  if (key)
    return crmOfflineHash({
      key,
      deviceId: text(input.deviceId || input.device_id),
    }).slice(0, 32);
  return randomUUID();
}
export function calculateOfflineRetry(input = {}) {
  const attempts = Math.max(0, Math.trunc(number(input.attempts)));
  const retryable = input.retryable !== false && attempts < 5;
  const delayMs = retryable
    ? Math.min(3600000, 2 ** Math.max(1, attempts) * 5000)
    : null;
  return {
    retryable,
    delayMs,
    nextAttemptAt:
      delayMs === null
        ? null
        : new Date(number(input.now, Date.now()) + delayMs).toISOString(),
  };
}
export function normalizeOfflineMutation(input = {}) {
  const operation = text(input.operation),
    resource = text(input.resource),
    idempotencyKey = text(input.idempotencyKey || input.idempotency_key),
    payload = object(input.payload);
  const allowed = new Set([
    "leads:create",
    "opportunities:stage",
    "activities:create",
    "activities:complete",
  ]);
  if (!allowed.has(`${resource}:${operation}`))
    throw new CrmOfflineSyncError(
      400,
      "Unsupported offline CRM mutation.",
      "CRM_OFFLINE_MUTATION_UNSUPPORTED",
    );
  if (!idempotencyKey)
    throw new CrmOfflineSyncError(
      400,
      "Offline mutation idempotency key is required.",
      "CRM_OFFLINE_IDEMPOTENCY_REQUIRED",
    );
  return {
    clientMutationId: text(
      input.clientMutationId ||
        input.client_mutation_id ||
        createOfflineMutationId(input),
    ),
    deviceId: text(input.deviceId || input.device_id),
    operation,
    resource,
    recordId: text(input.recordId || input.record_id) || null,
    idempotencyKey,
    payload,
    baseUpdatedAt: text(input.baseUpdatedAt || input.base_updated_at) || null,
    payloadHash: crmOfflineHash(payload),
  };
}
export function resolveOfflineConflict(input = {}) {
  const strategy = text(input.strategy || "server-wins"),
    server = object(input.server),
    client = object(input.client);
  if (strategy === "server-wins") return { strategy, resolved: server };
  if (strategy === "client-wins")
    return { strategy, resolved: { ...server, ...client } };
  if (strategy === "field-merge") {
    const fields = array(input.clientFields || input.client_fields).map(text);
    return {
      strategy,
      resolved: {
        ...server,
        ...Object.fromEntries(
          fields.filter((k) => k in client).map((k) => [k, client[k]]),
        ),
      },
    };
  }
  throw new CrmOfflineSyncError(
    400,
    "Unsupported offline conflict strategy.",
    "CRM_OFFLINE_CONFLICT_STRATEGY_INVALID",
  );
}
export function compactOfflineChanges(changesValue) {
  const latest = new Map();
  for (const row of array(changesValue)) {
    const key = `${text(row.resource)}:${text(row.recordId || row.record_id)}`;
    latest.set(key, row);
  }
  return [...latest.values()].sort(
    (a, b) => number(a.sequence) - number(b.sequence),
  );
}
function assertContext(c) {
  if (!c?.organizationId || !c?.userId)
    throw new CrmOfflineSyncError(
      401,
      "An authenticated CRM context is required.",
      "CRM_CONTEXT_REQUIRED",
    );
}
async function currentRecord(client, context, m) {
  if (m.resource === "opportunities" && m.recordId)
    return (
      (
        await client.query(
          `SELECT id,stage_id,updated_at,status FROM tenant.crm_opportunities WHERE organization_id=$1 AND id=$2`,
          [context.organizationId, m.recordId],
        )
      ).rows[0] || null
    );
  if (m.resource === "activities" && m.recordId)
    return (
      (
        await client.query(
          `SELECT id,status,updated_at FROM tenant.crm_activities WHERE organization_id=$1 AND id=$2`,
          [context.organizationId, m.recordId],
        )
      ).rows[0] || null
    );
  return null;
}
export async function applyOfflineMutation(client, context, input = {}) {
  assertContext(context);
  const m = normalizeOfflineMutation(input);
  const existing = (
    await client.query(
      `SELECT * FROM tenant.crm_mobile_mutations WHERE organization_id=$1 AND idempotency_key=$2`,
      [context.organizationId, m.idempotencyKey],
    )
  ).rows[0];
  if (existing) return { mutation: existing, idempotent: true };
  const current = await currentRecord(client, context, m);
  if (
    current &&
    m.baseUpdatedAt &&
    new Date(current.updated_at).toISOString() !==
      new Date(m.baseUpdatedAt).toISOString()
  ) {
    const conflict = (
      await client.query(
        `INSERT INTO tenant.crm_mobile_conflicts(organization_id,client_mutation_id,resource,record_id,server_payload,client_payload,status,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,'open',$7) RETURNING *`,
        [
          context.organizationId,
          m.clientMutationId,
          m.resource,
          m.recordId,
          JSON.stringify(current),
          JSON.stringify(m.payload),
          context.userId,
        ],
      )
    ).rows[0];
    const mutation = (
      await client.query(
        `INSERT INTO tenant.crm_mobile_mutations(organization_id,client_mutation_id,device_id,operation,resource,record_id,idempotency_key,payload,payload_hash,status,error_code,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,'conflict','CRM_OFFLINE_CONFLICT',$10,$10) RETURNING *`,
        [
          context.organizationId,
          m.clientMutationId,
          m.deviceId || null,
          m.operation,
          m.resource,
          m.recordId,
          m.idempotencyKey,
          JSON.stringify(m.payload),
          m.payloadHash,
          context.userId,
        ],
      )
    ).rows[0];
    return { mutation, conflict, idempotent: false };
  }
  let row;
  if (m.resource === "leads" && m.operation === "create") {
    const p = m.payload;
    if (
      ["status", "stage", "stageId", "stage_id", "stageCode", "stage_code", "recordStatus", "record_status"].some(
        (field) => Object.prototype.hasOwnProperty.call(p, field),
      )
    )
      throw new CrmOfflineSyncError(
        409,
        "Offline Lead creation cannot choose a lifecycle stage; the initial stage is assigned by the server.",
        "CRM_OFFLINE_LEAD_STAGE_GOVERNED",
      );
    if (!text(p.code) || !text(p.firstName || p.first_name))
      throw new CrmOfflineSyncError(
        400,
        "Offline lead creation requires code and first name.",
        "CRM_OFFLINE_LEAD_INVALID",
      );
    const ownerProvided =
      Object.prototype.hasOwnProperty.call(p, "ownerUserId") ||
      Object.prototype.hasOwnProperty.call(p, "owner_user_id");
    row = await createCrmRecord(client, context, "leads", {
      companyId: p.companyId || p.company_id || context.activeCompanyId || null,
      branchId: p.branchId || p.branch_id || context.activeBranchId || null,
      code: text(p.code),
      firstName: text(p.firstName || p.first_name),
      lastName: text(p.lastName || p.last_name) || null,
      email: text(p.email) || null,
      phone: text(p.phone) || null,
      mobile: text(p.mobile) || null,
      companyName: text(p.companyName || p.company_name) || null,
      priority: text(p.priority || "medium"),
      rating: text(p.rating || "warm"),
      customData: object(p.customData || p.custom_data),
      ...(ownerProvided
        ? { ownerUserId: p.ownerUserId || p.owner_user_id || null }
        : {}),
    });
  } else if (m.resource === "opportunities" && m.operation === "stage") {
    if (!m.recordId || !text(m.payload.stageId || m.payload.stage_id))
      throw new CrmOfflineSyncError(
        400,
        "Offline stage movement requires opportunity and stage.",
        "CRM_OFFLINE_STAGE_INVALID",
      );
    row = (
      await client.query(
        `UPDATE tenant.crm_opportunities SET stage_id=$3,next_step=COALESCE($4,next_step),updated_by=$5,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
        [
          context.organizationId,
          m.recordId,
          m.payload.stageId || m.payload.stage_id,
          text(m.payload.note) || null,
          context.userId,
        ],
      )
    ).rows[0];
  } else if (m.resource === "activities" && m.operation === "create") {
    const p = m.payload;
    if (text(p.activityType || p.activity_type || "task").toLowerCase() === "call")
      throw new CrmOfflineSyncError(410, "Use the governed Calls mobile endpoint for offline Call creation.", "CRM_CALL_API_MOVED");
    row = (
      await client.query(
        `INSERT INTO tenant.crm_activities(organization_id,company_id,branch_id,entity_type,entity_id,activity_type,subject,description,status,priority,assigned_to,start_at,due_at,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING *`,
        [
          context.organizationId,
          p.companyId || p.company_id || context.activeCompanyId || null,
          p.branchId || p.branch_id || context.activeBranchId || null,
          text(p.entityType || p.entity_type || "general"),
          p.entityId || p.entity_id || null,
          text(p.activityType || p.activity_type || "task"),
          text(p.subject),
          text(p.description) || null,
          text(p.status || "planned"),
          text(p.priority || "medium"),
          p.assignedTo || p.assigned_to || context.userId,
          p.startAt || p.start_at || null,
          p.dueAt || p.due_at || null,
          context.userId,
        ],
      )
    ).rows[0];
  } else if (m.resource === "activities" && m.operation === "complete") {
    if (!m.recordId)
      throw new CrmOfflineSyncError(
        400,
        "Offline activity completion requires a record id.",
        "CRM_OFFLINE_ACTIVITY_ID_REQUIRED",
      );
    const target = (await client.query(
      `SELECT activity_type FROM tenant.crm_activities WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, m.recordId],
    )).rows[0];
    if (target?.activity_type === "call")
      throw new CrmOfflineSyncError(410, "Use the governed Calls mobile endpoint for offline Call completion.", "CRM_CALL_API_MOVED");
    row = (
      await client.query(
        `UPDATE tenant.crm_activities SET status='completed',outcome=$3,completed_at=now(),updated_by=$4,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
        [
          context.organizationId,
          m.recordId,
          text(m.payload.outcome) || null,
          context.userId,
        ],
      )
    ).rows[0];
  }
  if (!row)
    throw new CrmOfflineSyncError(
      404,
      "Offline mutation target was not found.",
      "CRM_OFFLINE_TARGET_NOT_FOUND",
    );
  const mutation = (
    await client.query(
      `INSERT INTO tenant.crm_mobile_mutations(organization_id,client_mutation_id,device_id,operation,resource,record_id,idempotency_key,payload,payload_hash,status,result_payload,applied_at,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,'applied',$10::jsonb,now(),$11,$11) RETURNING *`,
      [
        context.organizationId,
        m.clientMutationId,
        m.deviceId || null,
        m.operation,
        m.resource,
        row.id,
        m.idempotencyKey,
        JSON.stringify(m.payload),
        m.payloadHash,
        JSON.stringify(row),
        context.userId,
      ],
    )
  ).rows[0];
  await client.query(
    `INSERT INTO tenant.crm_mobile_change_log(organization_id,resource,record_id,operation,payload,payload_hash,changed_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)`,
    [
      context.organizationId,
      m.resource,
      row.id,
      m.operation,
      JSON.stringify(row),
      crmOfflineHash(row),
      context.userId,
    ],
  );
  return { mutation, record: row, idempotent: false };
}
export async function applyOfflineBatch(client, context, input = {}) {
  assertContext(context);
  const mutations = array(input.mutations);
  if (mutations.length > 50)
    throw new CrmOfflineSyncError(
      400,
      "Offline batches are limited to 50 mutations.",
      "CRM_OFFLINE_BATCH_TOO_LARGE",
    );
  const results = [];
  for (const mutation of mutations) {
    try {
      results.push({
        ok: true,
        ...(await applyOfflineMutation(client, context, mutation)),
      });
    } catch (error) {
      results.push({
        ok: false,
        clientMutationId:
          mutation.clientMutationId || mutation.client_mutation_id || null,
        error: {
          code: error?.code || "CRM_OFFLINE_APPLY_FAILED",
          message:
            error instanceof Error ? error.message : "Offline mutation failed",
          retryable: Number(error?.status) >= 500,
        },
      });
    }
  }
  return {
    results,
    applied: results.filter((r) => r.ok && !r.conflict).length,
    conflicts: results.filter((r) => r.conflict).length,
    failed: results.filter((r) => !r.ok).length,
  };
}
export async function getOfflineChanges(client, context, input = {}) {
  assertContext(context);
  const cursor = Math.max(0, Math.trunc(number(input.cursor)));
  const limit = Math.min(
    200,
    Math.max(1, Math.trunc(number(input.limit, 100))),
  );
  const result = await client.query(
    `SELECT sequence,resource,record_id,operation,payload,payload_hash,changed_at FROM tenant.crm_mobile_change_log WHERE organization_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3`,
    [context.organizationId, cursor, limit],
  );
  const changes = compactOfflineChanges(result.rows);
  return {
    changes,
    nextCursor: result.rows.length
      ? Number(result.rows[result.rows.length - 1].sequence)
      : cursor,
    hasMore: result.rows.length === limit,
  };
}
export async function resolveStoredOfflineConflict(
  client,
  context,
  input = {},
) {
  assertContext(context);
  const conflict = (
    await client.query(
      `SELECT * FROM tenant.crm_mobile_conflicts WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [context.organizationId, input.conflictId || input.conflict_id],
    )
  ).rows[0];
  if (!conflict)
    throw new CrmOfflineSyncError(
      404,
      "Offline conflict was not found.",
      "CRM_OFFLINE_CONFLICT_NOT_FOUND",
    );
  const resolution = resolveOfflineConflict({
    strategy: input.strategy,
    server: conflict.server_payload,
    client: conflict.client_payload,
    clientFields: input.clientFields,
  });
  const result = await client.query(
    `UPDATE tenant.crm_mobile_conflicts SET status='resolved',resolution=$3::jsonb,resolved_by=$4,resolved_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [
      context.organizationId,
      conflict.id,
      JSON.stringify(resolution),
      context.userId,
    ],
  );
  return result.rows[0];
}
export async function recordCrmOfflineAcceptance(client, context, input = {}) {
  assertContext(context);
  const evidence = object(input.evidence);
  const result = await client.query(
    `INSERT INTO tenant.crm_mobile_acceptance_evidence(organization_id,capability_id,commit_sha,status,evidence,evidence_hash,verified_by) VALUES($1,'CRM-072',$2,$3,$4::jsonb,$5,$6) ON CONFLICT(organization_id,capability_id,commit_sha) DO UPDATE SET status=EXCLUDED.status,evidence=EXCLUDED.evidence,evidence_hash=EXCLUDED.evidence_hash,verified_by=EXCLUDED.verified_by,verified_at=now() RETURNING *`,
    [
      context.organizationId,
      text(input.commitSha || input.commit_sha || "local"),
      text(input.status || "passed"),
      JSON.stringify(evidence),
      crmOfflineHash(evidence),
      context.userId,
    ],
  );
  return result.rows[0];
}
export async function getCrmOfflineReadiness(
  client,
  context,
  commitSha = "local",
) {
  assertContext(context);
  const result = await client.query(
    `SELECT status FROM tenant.crm_mobile_acceptance_evidence WHERE organization_id=$1 AND capability_id='CRM-072' AND commit_sha=$2`,
    [context.organizationId, commitSha],
  );
  return {
    readiness: result.rows[0]?.status === "passed" ? "ready" : "blocked",
    passed: result.rows[0]?.status === "passed" ? 1 : 0,
    total: 1,
  };
}
