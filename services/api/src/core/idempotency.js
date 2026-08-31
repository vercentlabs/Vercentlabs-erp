import { createHash } from "node:crypto";

export class IdempotencyError extends Error {
  constructor(status, message, code = "IDEMPOTENCY_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) return String(value);
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function canonicalPayloadJson(payload) {
  return JSON.stringify(canonicalize(payload ?? null));
}

export function requestPayloadHash(payload) {
  return createHash("sha256").update(canonicalPayloadJson(payload)).digest("hex");
}

function normalizedKey(value) {
  const key = String(value || "").trim();
  if (!key) return null;
  if (key.length > 200) {
    throw new IdempotencyError(400, "Idempotency key is too long.", "IDEMPOTENCY_KEY_INVALID");
  }
  return key;
}

function normalizedOperation(value) {
  const operation = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9._:-]{1,160}$/.test(operation)) {
    throw new IdempotencyError(400, "Idempotency operation is invalid.", "IDEMPOTENCY_OPERATION_INVALID");
  }
  return operation;
}

/**
 * Reserve an idempotency key inside the caller's transaction. PostgreSQL's
 * unique-index conflict handling serializes concurrent contenders. Because the
 * reservation lives in the same business transaction, rollback removes it.
 */
export async function beginIdempotentOperation(
  client,
  context,
  { operation, key, payload, required = false } = {},
) {
  const idempotencyKey = normalizedKey(key);
  if (!idempotencyKey) {
    if (required) {
      throw new IdempotencyError(400, "An idempotency key is required.", "IDEMPOTENCY_KEY_REQUIRED");
    }
    return { enabled: false, replayed: false, operation: normalizedOperation(operation) };
  }
  if (!context?.organizationId || !context?.companyId) {
    throw new IdempotencyError(400, "Organization and active company are required for idempotency.", "IDEMPOTENCY_SCOPE_REQUIRED");
  }

  const normalized = normalizedOperation(operation);
  const requestHash = requestPayloadHash(payload);
  const inserted = await client.query(
    `INSERT INTO tenant.operation_idempotency
      (organization_id,company_id,operation,idempotency_key,request_hash,status,created_by)
     VALUES ($1,$2,$3,$4,$5,'processing',$6)
     ON CONFLICT (organization_id,company_id,operation,idempotency_key) DO NOTHING
     RETURNING id`,
    [
      context.organizationId,
      context.companyId,
      normalized,
      idempotencyKey,
      requestHash,
      context.userId || null,
    ],
  );
  if (inserted.rows[0]) {
    return {
      enabled: true,
      replayed: false,
      operation: normalized,
      key: idempotencyKey,
      requestHash,
      recordId: inserted.rows[0].id,
    };
  }

  const existing = await client.query(
    `SELECT id,request_hash,status,response_payload,aggregate_type,aggregate_id
     FROM tenant.operation_idempotency
     WHERE organization_id=$1 AND company_id=$2 AND operation=$3 AND idempotency_key=$4
     FOR UPDATE`,
    [context.organizationId, context.companyId, normalized, idempotencyKey],
  );
  const row = existing.rows[0];
  if (!row) {
    throw new IdempotencyError(409, "The idempotency reservation could not be resolved. Retry the request.", "IDEMPOTENCY_RETRY_REQUIRED");
  }
  if (row.request_hash !== requestHash) {
    throw new IdempotencyError(
      409,
      "This idempotency key was already used with a different request payload.",
      "IDEMPOTENCY_KEY_REUSED",
    );
  }
  if (row.status !== "completed") {
    throw new IdempotencyError(409, "An operation with this idempotency key is still in progress.", "IDEMPOTENCY_IN_PROGRESS");
  }
  return {
    enabled: true,
    replayed: true,
    operation: normalized,
    key: idempotencyKey,
    requestHash,
    recordId: row.id,
    response: row.response_payload,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
  };
}

export async function completeIdempotentOperation(
  client,
  context,
  token,
  { response, aggregateType = null, aggregateId = null } = {},
) {
  if (!token?.enabled || token.replayed) return response;
  const updated = await client.query(
    `UPDATE tenant.operation_idempotency
     SET status='completed',response_payload=$6::jsonb,aggregate_type=$7,aggregate_id=$8,completed_at=now(),updated_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND operation=$3 AND idempotency_key=$4 AND request_hash=$5
     RETURNING id`,
    [
      context.organizationId,
      context.companyId,
      token.operation,
      token.key,
      token.requestHash,
      JSON.stringify(response ?? null),
      aggregateType,
      aggregateId,
    ],
  );
  if (!updated.rows[0]) {
    throw new IdempotencyError(409, "The idempotency result could not be finalized.", "IDEMPOTENCY_FINALIZE_FAILED");
  }
  return response;
}
