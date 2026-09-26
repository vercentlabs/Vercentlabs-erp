// Privacy requests and versioned retention policies (Shared Platform,
// Settings > Privacy and retention; platform.privacy.manage). Security
// property preserved from T01: an explicit finite-state-machine transition
// table (received -> verified/rejected/cancelled -> in_progress -> completed)
// enforced via assertPrivacyTransition on every transition, including
// inside the row-locked DB transaction — illegal jumps are rejected, not
// silently coerced.
import { audit } from "../../security.js";
import { getPrivacyDataClass, PRIVACY_DATA_CLASSES } from "./data-classes.js";

export class PrivacyError extends Error {
  constructor(status, message, code = "PRIVACY_ERROR") {
    super(message);
    this.name = "PrivacyError";
    this.status = status;
    this.code = code;
  }
}

function text(value, name, maximum = 240) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new PrivacyError(400, `${name} is required.`);
  if (normalized.length > maximum) throw new PrivacyError(400, `${name} is too long.`);
  return normalized;
}

const PRIVACY_TRANSITIONS = {
  received: ["verified", "rejected", "cancelled"],
  verified: ["in_progress", "rejected", "cancelled"],
  in_progress: ["completed", "rejected", "cancelled"],
  completed: [],
  rejected: [],
  cancelled: [],
};

export function assertPrivacyTransition(current, next) {
  if (!(PRIVACY_TRANSITIONS[current] || []).includes(next)) {
    throw new PrivacyError(409, `Privacy request cannot move from ${current} to ${next}.`);
  }
}

export async function createPrivacyRequest(client, session, input) {
  const requestType = text(input.requestType, "Privacy request type", 80);
  if (!["access", "export", "correction", "restriction", "erasure", "consent_withdrawal"].includes(requestType)) {
    throw new PrivacyError(400, "Privacy request type is invalid.");
  }
  const subjectReference = text(input.subjectReference, "Subject reference", 240);
  const result = await client.query(
    `INSERT INTO privacy_requests(
       organization_id,request_type,subject_reference,request_payload,requested_by
     ) VALUES($1,$2,$3,$4::jsonb,$5) RETURNING id,status`,
    [session.organizationId, requestType, subjectReference, JSON.stringify(input.payload ?? {}), session.userId],
  );
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "privacy.request_created", entityType: "privacy_request", entityId: result.rows[0].id, metadata: { requestType } });
  return result.rows[0];
}

export async function transitionPrivacyRequest(client, session, idValue, nextValue, resultPayload) {
  const id = text(idValue, "Privacy request id", 80);
  const next = text(nextValue, "Privacy request status", 40);
  const locked = await client.query(
    `SELECT status FROM privacy_requests WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
    [id, session.organizationId],
  );
  const current = locked.rows[0];
  if (!current) throw new PrivacyError(404, "Privacy request not found.");
  assertPrivacyTransition(current.status, next);
  const result = await client.query(
    `UPDATE privacy_requests SET status=$3,result_payload=$4::jsonb,
       completed_at=CASE WHEN $3='completed' THEN now() ELSE completed_at END,
       updated_at=now()
     WHERE id=$1 AND organization_id=$2 RETURNING status,completed_at`,
    [id, session.organizationId, next, resultPayload == null ? null : JSON.stringify(resultPayload)],
  );
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "privacy.request_transitioned", entityType: "privacy_request", entityId: id, beforeData: { status: current.status }, afterData: { status: next } });
  return result.rows[0];
}

export async function listPrivacyRequests(client, organizationId) {
  const result = await client.query(
    `SELECT request.id,request.request_type,request.subject_reference,request.status,request.requested_by,requester.full_name AS requested_by_name,
            request.assigned_to,request.requested_at,request.completed_at,request.updated_at
       FROM privacy_requests request LEFT JOIN users requester ON requester.id=request.requested_by
      WHERE request.organization_id=$1
      ORDER BY request.requested_at DESC,request.id DESC LIMIT 250`,
    [organizationId],
  );
  return result.rows.map((row) => ({ ...row, allowedTransitions: PRIVACY_TRANSITIONS[row.status] || [] }));
}

export async function writeRetentionPolicy(client, session, input) {
  const dataClass = text(input.dataClass, "Privacy data class", 120);
  // Only registered data classes: a free-text class could never be enforced or reviewed.
  if (!getPrivacyDataClass(dataClass)) throw new PrivacyError(400, "Choose a data class from the list.", "PRIVACY_DATA_CLASS_UNKNOWN");
  const retentionDays = Number(input.retentionDays);
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 36500) {
    throw new PrivacyError(400, "Retention days must be an integer between 1 and 36500.");
  }
  const legalBasis = text(input.legalBasis, "Privacy legal basis", 500);
  const effectiveFrom = input.effectiveFrom ? new Date(String(input.effectiveFrom)) : new Date();
  const effectiveTo = input.effectiveTo ? new Date(String(input.effectiveTo)) : null;
  if (!Number.isFinite(effectiveFrom.getTime()) || (effectiveTo && !Number.isFinite(effectiveTo.getTime()))) {
    throw new PrivacyError(400, "Privacy policy effective timestamp is invalid.");
  }
  if (effectiveTo && effectiveTo <= effectiveFrom) throw new PrivacyError(400, "Privacy policy end must be after its start.");

  await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [session.organizationId, `retention:${dataClass}`]);
  const current = await client.query(
    `SELECT version FROM privacy_retention_policies
      WHERE organization_id=$1 AND data_class=$2 ORDER BY version DESC LIMIT 1`,
    [session.organizationId, dataClass],
  );
  const later = await client.query(
    `SELECT 1 FROM privacy_retention_policies
      WHERE organization_id=$1 AND data_class=$2 AND effective_from >= $3
      LIMIT 1`,
    [session.organizationId, dataClass, effectiveFrom],
  );
  if (later.rows[0]) {
    throw new PrivacyError(409, "A retention-policy version already starts at or after this timestamp. Reorder the scheduled version first.");
  }
  await client.query(
    `UPDATE privacy_retention_policies SET effective_to=$3
      WHERE organization_id=$1 AND data_class=$2 AND effective_from<$3
        AND (effective_to IS NULL OR effective_to>$3)`,
    [session.organizationId, dataClass, effectiveFrom],
  );
  const version = (current.rows[0]?.version || 0) + 1;
  const result = await client.query(
    `INSERT INTO privacy_retention_policies(
       organization_id,data_class,retention_days,legal_basis,effective_from,effective_to,version,created_by
     ) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,version`,
    [session.organizationId, dataClass, retentionDays, legalBasis, effectiveFrom, effectiveTo, version, session.userId],
  );
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "privacy.retention_policy_versioned", entityType: "retention_policy", entityId: result.rows[0].id, afterData: { dataClass, retentionDays, version } });
  return result.rows[0];
}

// Each policy says honestly how it is (or is not) enforced.
export async function listRetentionPolicies(client, organizationId) {
  const result = await client.query(
    `SELECT id,data_class,retention_days,legal_basis,effective_from,effective_to,version,created_at
       FROM privacy_retention_policies WHERE organization_id=$1
      ORDER BY data_class,version DESC,id DESC LIMIT 500`,
    [organizationId],
  );
  return result.rows.map((row) => {
    const dataClass = getPrivacyDataClass(row.data_class);
    return { ...row, dataClassLabel: dataClass?.label ?? "Unrecognised data class (recorded before the registry)", enforcement: dataClass?.enforcement ?? "review_required", enforcementNote: dataClass?.note ?? "Recorded only; no automatic deletion." };
  });
}

export function listPrivacyDataClasses() {
  return PRIVACY_DATA_CLASSES.map(({ key, label, moduleKey, enforcement, note }) => ({ key, label, moduleKey, enforcement, note }));
}
