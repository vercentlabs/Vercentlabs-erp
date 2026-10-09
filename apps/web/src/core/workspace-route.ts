import "server-only";

import {
  assertSameOriginOrMobile,
  authorize,
  beginIdempotentOperation,
  buildWorkspaceAccessSnapshot,
  completeIdempotentOperation,
  createAccessPrincipal,
  denialToError,
  logAccessDenial,
  recordAccessDenial,
  recordBlockedNegativeStockAttempt,
  requireBillingWriteAccess,
} from "@vercentlabs/api";
import { createLogger, runWithContext } from "@vercentlabs/observability";
import type { PoolClient } from "pg";

import { organizationConnection, tenantTransaction } from "@/core/db";
import { errorResponse } from "@/core/http";
import {
  requireApiWorkspace,
  type WorkspaceSessionContext,
} from "@/core/session";

import {
  createSecureRoute,
  type DeniedAccessEvent,
  type SecureRouteContext,
  type SecureRouteOptions,
} from "./secure-route.ts";

const logger = createLogger("web");
const SLOW_REQUEST_MILLISECONDS = 2_000;

function requestIds(request: Request) {
  return {
    requestId: request.headers.get("x-request-id"),
    correlationId: request.headers.get("x-correlation-id"),
  };
}

function denialDecision(event: DeniedAccessEvent) {
  return {
    allowed: false as const,
    code: (event.code ?? "PERMISSION_DENIED") as "PERMISSION_DENIED",
    status: event.status,
    module: event.module,
    permission: event.permission,
    action: event.action,
    reason: null,
    conceal: event.status === 404,
  };
}

export type WorkspaceRouteContext = SecureRouteContext<
  WorkspaceSessionContext,
  PoolClient
>;

// Double submits. A form sends one Idempotency-Key for everything it submits
// (see shared/http/submit-once.ts); a POST that repeats a key with the
// same JSON body gets the first answer back instead of doing the work again,
// so a second click on "Create" never makes a second record. The reservation
// lives in the request's own transaction: a thrown error rolls it back, and an
// error response releases it, so a corrected retry with the same key still
// runs. Requests without the header behave exactly as before.
const IDEMPOTENCY_HEADER = "idempotency-key";
function idempotentHandler(
  request: Request,
  options: SecureRouteOptions,
  handler: (context: WorkspaceRouteContext) => Promise<Response>,
): (context: WorkspaceRouteContext) => Promise<Response> {
  const key = request.headers.get(IDEMPOTENCY_HEADER)?.trim();
  const json = (request.headers.get("content-type") ?? "").includes("application/json");
  if (!key || request.method !== "POST" || !json || options.transaction === "none") return handler;
  return async (context) => {
    const scope = { organizationId: context.session.organizationId, userId: context.session.userId ?? null };
    const path = new URL(request.url).pathname.toLowerCase().replace(/[^a-z0-9._-]+/g, ":").slice(0, 150);
    const token = await beginIdempotentOperation(context.client, scope, {
      operation: `http.post${path}`,
      key,
      payload: { body: await request.clone().text() },
    });
    if (token.replayed) {
      const stored = token.response as { status: number; body: unknown } | null;
      return Response.json(stored?.body ?? null, { status: stored?.status ?? 200, headers: { "idempotent-replay": "true" } });
    }
    const response = await handler(context);
    const body = response.ok ? await response.clone().json().catch(() => undefined) : undefined;
    if (body === undefined) {
      // Nothing to replay (an error, or not JSON): let the key be used again.
      await context.client.query(
        "DELETE FROM tenant.operation_idempotency WHERE organization_id = $1 AND operation = $2 AND idempotency_key = $3",
        [scope.organizationId, token.operation, token.key],
      );
      return response;
    }
    await completeIdempotentOperation(context.client, scope, token, { response: { status: response.status, body } });
    return response;
  };
}
// The preferred protected-route composition (see core/secure-route.ts for
// the enforced order). Usage, inside an exported HTTP method function:
//
//   export async function POST(request: Request) {
//     return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true },
//       async ({ client, principal }) => ok({ record: await createThing(client, principal, await readJson(request)) }, 201));
//   }
//
// scripts/qa/generate-route-security-matrix.mjs audits this function's body:
// it must keep calling requireApiWorkspace(), assertSameOriginOrMobile() and
// authorize(), or every route using it stops being treated as protected.
export async function workspaceRoute(
  request: Request,
  options: SecureRouteOptions,
  handler: (context: WorkspaceRouteContext) => Promise<Response>,
): Promise<Response> {
  const secureRoute = createSecureRoute<WorkspaceSessionContext, PoolClient>({
    assertOrigin: (incoming) => assertSameOriginOrMobile(incoming, process.env),
    requireSession: () => requireApiWorkspace(),
    // A stock movement refused by Negative-Stock Control is audited in its own short transaction once the request's has rolled back.
    runTenant: async (organizationId, work) => {
      try {
        return await tenantTransaction(organizationId, work);
      } catch (error) {
        if ((error as { negativeStockEvent?: unknown } | null)?.negativeStockEvent) {
          await tenantTransaction(organizationId, (client) => recordBlockedNegativeStockAttempt(client, organizationId, null, error)).catch((auditError) => {
            console.error("negative_stock_audit_failed", { error: auditError instanceof Error ? auditError.message : "unknown" });
          });
        }
        throw error;
      }
    },
    runOrganizationConnection: (organizationId, work) =>
      organizationConnection(organizationId, work),
    createPrincipal: (session) => createAccessPrincipal(session),
    buildSnapshot: (client, session) =>
      buildWorkspaceAccessSnapshot(client, session, { env: process.env }),
    authorize: (input) => authorize(input),
    denialToError: (decision) => denialToError(decision),
    onDenied: (decision, principal, incoming) =>
      logAccessDenial(decision, principal, {
        requestId: incoming.headers.get("x-request-id"),
        correlationId: incoming.headers.get("x-correlation-id"),
      }),
    requireBillingWrite: (client, organizationId) =>
      requireBillingWriteAccess(client, organizationId, process.env),
    logDeniedAccess: (event) =>
      logAccessDenial(
        denialDecision(event),
        event.principal,
        requestIds(event.request),
      ),
    // Its own short organisation-context transaction: the request transaction
    // has already rolled back, and this evidence must survive it.
    recordDeniedAccess: async (event) => {
      try {
        await tenantTransaction(event.principal.organizationId, (client) =>
          recordAccessDenial(client, {
            decision: denialDecision(event),
            principal: event.principal,
            request: event.request,
            env: process.env,
            ...requestIds(event.request),
          }),
        );
      } catch (error) {
        console.error("access_denial_audit_failed", {
          code: event.code,
          action: event.action,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    },
    toErrorResponse: (error) => errorResponse(error),
    withContext: (values, work) =>
      runWithContext({ ...values, userId: values.userId ?? undefined }, work),
  });
  // Log context for everything this request logs (proxy.ts guarantees the ids).
  // Per-request access logs come from the load balancer; the application logs
  // server errors and slow requests only.
  const startedAt = Date.now();
  return runWithContext(
    requestIds(request) as { requestId: string; correlationId: string },
    async () => {
      const response = await secureRoute(request, options, idempotentHandler(request, options, handler));
      const durationMs = Date.now() - startedAt;
      const fields = {
        method: request.method,
        path: new URL(request.url).pathname,
        status: response.status,
        durationMs,
        module: options.module ?? null,
        action: options.action ?? null,
      };
      if (response.status >= 500)
        logger.event("http.server_error", fields, "error");
      else if (durationMs >= SLOW_REQUEST_MILLISECONDS)
        logger.event("http.slow_request", fields, "warn");
      return response;
    },
  );
}
