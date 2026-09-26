import "server-only";

import {
  assertSameOriginOrMobile,
  authorize,
  buildWorkspaceAccessSnapshot,
  createAccessPrincipal,
  denialToError,
  logAccessDenial,
  recordAccessDenial,
  requireBillingWriteAccess,
} from "@vercentlabs/api";
import type { PoolClient } from "pg";

import { tenantTransaction } from "@/core/db";
import { errorResponse } from "@/core/http";
import { requireApiWorkspace, type WorkspaceSessionContext } from "@/core/session";

import { createSecureRoute, type DeniedAccessEvent, type SecureRouteContext, type SecureRouteOptions } from "./secure-route.ts";

function requestIds(request: Request) {
  return { requestId: request.headers.get("x-request-id"), correlationId: request.headers.get("x-correlation-id") };
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

export type WorkspaceRouteContext = SecureRouteContext<WorkspaceSessionContext, PoolClient>;
export type { SecureRouteOptions as WorkspaceRouteOptions };

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
    runTenant: (organizationId, work) => tenantTransaction(organizationId, work),
    createPrincipal: (session) => createAccessPrincipal(session),
    buildSnapshot: (client, session) => buildWorkspaceAccessSnapshot(client, session, { env: process.env }),
    authorize: (input) => authorize(input),
    denialToError: (decision) => denialToError(decision),
    onDenied: (decision, principal, incoming) =>
      logAccessDenial(decision, principal, {
        requestId: incoming.headers.get("x-request-id"),
        correlationId: incoming.headers.get("x-correlation-id"),
      }),
    requireBillingWrite: (client, organizationId) => requireBillingWriteAccess(client, organizationId, process.env),
    logDeniedAccess: (event) => logAccessDenial(denialDecision(event), event.principal, requestIds(event.request)),
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
        console.error("access_denial_audit_failed", { code: event.code, action: event.action, error: error instanceof Error ? error.message : "unknown" });
      }
    },
    toErrorResponse: (error) => errorResponse(error),
  });
  return secureRoute(request, options, handler);
}
