// Access audit and observability fields.
//
// accessLogFields() produces the structured, redaction-safe fields every
// access decision log line carries (requestId, correlationId,
// organizationId, userId, module, action, code/reason). It deliberately
// never includes session tokens, secrets or request bodies.
// recordAccessDenial() writes durable audit evidence through the existing
// audit_events writer (../security.js), which already redacts payloads.
import { createLogger } from "@vercentlabs/observability";

import { audit } from "../security/request-security.js";

const accessLogger = createLogger("shared-access");

export function accessLogFields(decision, principal, { requestId, correlationId } = {}) {
  return {
    requestId: requestId ?? null,
    correlationId: correlationId ?? requestId ?? null,
    organizationId: principal?.organizationId ?? null,
    userId: principal?.userId ?? null,
    module: decision?.module ?? null,
    action: decision?.action ?? null,
    permission: decision?.permission ?? null,
    allowed: Boolean(decision?.allowed),
    code: decision?.allowed ? null : decision?.code ?? null,
    reason: decision?.allowed ? null : decision?.reason ?? null,
  };
}

export async function recordAccessDenial(client, { decision, principal, request, env = process.env, requestId, correlationId, entityType = "access", entityId = null }) {
  if (!decision || decision.allowed) return;
  await audit(client, {
    organizationId: principal?.organizationId ?? null,
    actorUserId: principal?.userId ?? null,
    eventType: "access.denied",
    entityType,
    entityId,
    metadata: accessLogFields(decision, principal, { requestId, correlationId }),
    request,
    env,
  });
}

// Structured, redacted log line for a denial (via @vercentlabs/observability,
// which also merges the ambient requestId/correlationId context). Pass a
// logger in tests; production uses the shared "shared-access" logger.
export function logAccessDenial(decision, principal, ids = {}, logger = accessLogger) {
  if (!decision || decision.allowed) return null;
  return logger.warn("access.denied", accessLogFields(decision, principal, ids));
}

// Immutable access-assignment evidence (access_assignment_events, protected
// by an UPDATE/DELETE-blocking trigger). One row per effective change to a
// user's access: roles, company/branch scope, membership status, invitation
// acceptance. States are small id-level snapshots, never secrets. Written in
// the SAME transaction as the change, so evidence exists iff the change
// committed. Organization-level changes (module enablement, role
// definitions) use the general audit_events log instead.
export const ACCESS_EVIDENCE_EVENTS = Object.freeze({
  ROLES_CHANGED: "roles_changed",
  SCOPE_CHANGED: "access_scope_changed",
  MEMBER_ENABLED: "member_enabled",
  MEMBER_DISABLED: "member_disabled",
  INVITATION_ACCEPTED: "invitation_accepted",
});

export async function recordAccessAssignmentEvent(client, { organizationId, userId, actorUserId, eventType, beforeState = null, afterState = null }) {
  if (!Object.values(ACCESS_EVIDENCE_EVENTS).includes(eventType)) {
    throw new TypeError(`Unknown access evidence event: ${eventType}`);
  }
  await client.query(
    `INSERT INTO access_assignment_events (organization_id, user_id, actor_user_id, event_type, before_state, after_state)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [organizationId, userId, actorUserId ?? null, eventType, beforeState === null ? null : JSON.stringify(beforeState), afterState === null ? null : JSON.stringify(afterState)],
  );
}
