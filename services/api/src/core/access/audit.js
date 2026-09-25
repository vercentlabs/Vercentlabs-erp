// Access audit and observability fields.
//
// accessLogFields() produces the structured, redaction-safe fields every
// access decision log line carries (requestId, correlationId,
// organizationId, userId, module, action, code/reason). It deliberately
// never includes session tokens, secrets or request bodies.
// recordAccessDenial() writes durable audit evidence through the existing
// audit_events writer (../security.js), which already redacts payloads.
import { createLogger } from "@vercentlabs/observability";

import { audit } from "../security.js";

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
