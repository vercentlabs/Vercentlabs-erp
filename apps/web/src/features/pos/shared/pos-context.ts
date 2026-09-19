import "server-only";

import { assertModuleAccessible, requireBillingWriteAccess, requireSessionPermission } from "@vercentlabs/api";

import { HttpError } from "../../../core/http-errors.ts";
import type { WorkspaceSessionContext } from "@/core/session";

type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> };

// Mirrors apps/web/src/features/crm/shared/crm-context.ts's requireCrmAccess:
// every POS route must check both the module-entitlement floor (released/
// tenant-enabled/billing-entitled/pos.view) and, where the action needs
// more than baseline view access, the specific pos.* permission — neither
// layer substitutes for the other, and POS's own domain functions in
// services/api/src/modules/point-of-sale/index.js already enforce the
// pos.* permission a second time internally (requirePermission()), so this
// is defense in depth, not the only gate.
// `mutation: true` additionally requires an active subscription
// (requireBillingWriteAccess), mirroring crm-context.ts's requireCrmAccess.
// Opt-in, not automatic: this function gates POS's read routes too, and
// every existing call site keeps today's exact behavior unless it
// explicitly asks for the mutation check. Pass it only for a genuine
// business write (opening a shift, ringing a sale, recording a payment,
// issuing a refund, ...), never for a read, an export, or a security/
// recovery/day-close-reconciliation operation.
export async function requirePosAccess(
  client: QueryClient,
  session: WorkspaceSessionContext,
  permission?: string,
  options: { mutation?: boolean } = {},
) {
  await assertModuleAccessible(client, session, "point-of-sale", process.env);
  if (permission) requireSessionPermission(session, permission);
  if (options.mutation) await requireBillingWriteAccess(client, session.organizationId, process.env);
}

// Builds the context shape services/api/src/modules/point-of-sale/index.js
// expects. Unlike CrmContext, POS's domain functions read context.companyId
// directly (no allowAllCompanies fallback) — a store/terminal/shift/sale is
// always scoped to exactly one company, so an org owner browsing "all
// companies" must still pick one active company before using POS. Throw a
// clear, specific error here rather than letting every domain function's
// company_id NOT NULL constraint surface a confusing raw DB error.
export function posContext(session: WorkspaceSessionContext) {
  if (!session.activeCompanyId) {
    throw new HttpError(409, "Select an active company before using Point of Sale.", "POS_COMPANY_REQUIRED");
  }
  return {
    organizationId: session.organizationId,
    companyId: session.activeCompanyId,
    userId: session.userId,
    roleSlugs: session.roleSlugs,
    permissions: session.permissions,
  };
}

export type PosApiContext = ReturnType<typeof posContext>;
