import "server-only";

import { assertModuleAccessible, requireBillingWriteAccess, requireSessionPermission } from "@vercentlabs/api";

// Relative, not the "@/" alias: that alias is a tsconfig-only path that
// only Next's bundler resolves, not plain `node --test`. This file starts
// with `import "server-only"` (throws unconditionally outside Next's
// server runtime) so it can never itself be imported by a plain-node
// test — resolveCrmMutationPermission below is the actual deny-by-default
// decision logic, kept pure and alias-free in resource-permissions.ts
// specifically so it's unit-testable; this function is a thin wrapper.
import { HttpError } from "../../../core/http-errors.ts";
import type { WorkspaceSessionContext } from "@/core/session";
import { resolveCrmMutationPermission } from "./resource-permissions.ts";

type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> };

// Checkpoint audit (Prompt 3 continuation): every CRM route built so far
// only called requireWorkspace() — authentication + org membership — and
// then went straight to the domain function. Neither the module-
// entitlement layer (released/tenant-enabled/billing-entitled/crm.view,
// see module-entitlements.js's documented pipeline, which explicitly says
// "any server-side guard must call assertModuleAccessible() rather than
// re-implement any part of this pipeline") nor the resource-specific
// action permission (crm.leads.manage/crm.opportunities.manage/
// crm.accounts.manage/crm.activities.manage) was ever checked at the route
// layer. Most CRM domain functions don't check a baseline permission
// internally either (Lead's assign/qualify actions are the exception) --
// task-operations.js even says outright "gated by crm.activities.manage at
// the route level". This was a real, session-wide gap: any authenticated
// member of any organization could call any CRM mutation. This helper is
// the one place that closes it — call it first, inside the same
// withClient/tenantTransaction callback that runs the actual domain call,
// for every CRM route (mutating or not).
// `mutation: true` additionally requires an active subscription
// (requireBillingWriteAccess) before the caller proceeds -- opt-in, not
// automatic, because this same function gates CRM's read routes too
// (every existing call site passes no option and keeps today's exact
// behavior). Pass it only from a route/domain path that genuinely creates,
// updates, deletes, or otherwise writes a business record; never from a
// read, an export, or a security/recovery/billing-admin operation, which
// must remain reachable regardless of subscription state.
export async function requireCrmAccess(
  client: QueryClient,
  session: WorkspaceSessionContext,
  permission?: string,
  options: { mutation?: boolean } = {},
) {
  await assertModuleAccessible(client, session, "crm", process.env);
  if (permission) requireSessionPermission(session, permission);
  if (options.mutation) await requireBillingWriteAccess(client, session.organizationId, process.env);
}

// Checkpoint audit (ERP completion gap register, SEC-CRM-001): the
// mutating generic routes (POST /api/crm/[resource], PATCH/DELETE
// /api/crm/[resource]/[id]) called requireCrmAccess(client, session,
// RESOURCE_MANAGE_PERMISSIONS[resource]) directly — for any of the ~40
// CRM_RESOURCE_KEYS entries with no map entry, that argument is
// `undefined`, and requireCrmAccess's `if (permission)` guard above skips
// the permission check entirely, leaving only the crm.view module-access
// floor. Any CRM member — including a restricted, read-only viewer —
// could mutate an unmapped resource (e.g. communications, custom-records,
// dashboards, ai-feedback, ...) by calling the endpoint directly, whether
// or not any UI exposed that action. This is the single required call for
// a mutating generic-resource route: it fails closed for anything not
// explicitly mapped or explicitly self-scoped, instead of silently
// falling through.
export async function requireCrmMutationAccess(client: QueryClient, session: WorkspaceSessionContext, resource: string) {
  await assertModuleAccessible(client, session, "crm", process.env);
  const resolution = resolveCrmMutationPermission(resource);
  if (resolution.kind === "self-scoped") {
    await requireBillingWriteAccess(client, session.organizationId, process.env);
    return;
  }
  if (resolution.kind === "requires-permission") {
    requireSessionPermission(session, resolution.permission);
    await requireBillingWriteAccess(client, session.organizationId, process.env);
    return;
  }
  throw new HttpError(403, "You do not have permission to modify this CRM resource.", "PERMISSION_DENIED");
}

// Builds the CrmContext shape services/api/src/modules/crm/*.js functions
// expect (@vercentlabs/shared-types' CrmContext), from the already-
// resolved workspace session — the same allowAllCompanies computation
// used everywhere else in the shell (services/api/src/core/approvals.js,
// the ported access-administration module).
export function crmContext(session: WorkspaceSessionContext) {
  return {
    organizationId: session.organizationId,
    userId: session.userId,
    activeCompanyId: session.activeCompanyId,
    activeBranchId: session.activeBranchId,
    allowAllCompanies:
      session.roleSlugs.includes("organization_owner") ||
      session.roleSlugs.includes("system_administrator"),
    permissions: session.permissions,
    roleSlugs: session.roleSlugs,
  };
}

export type CrmApiContext = ReturnType<typeof crmContext>;
