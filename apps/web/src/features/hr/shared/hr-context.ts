import "server-only";

import { assertModuleAccessible, requireBillingWriteAccess, requireSessionPermission, hrContext as domainContext } from "@vercentlabs/api";

import type { WorkspaceSessionContext } from "@/core/session";

type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> };

// Same layered gate as Inventory/Procurement: module entitlement, then a permission, then (for a
// business write only) an active subscription. The route-level permission is hr_payroll.view; each
// operation is re-checked against ITS OWN permission inside the domain (bom.manage, work_order.release,
// production.post, ...), which is where segregation of duties lives.
export async function requireHrAccess(client: QueryClient, session: WorkspaceSessionContext, permission: string, options: { mutation?: boolean } = {}) {
  try {
    await assertModuleAccessible(client, session, "hr-payroll", process.env);
  } catch (error) {
    // Employee self-service (permission ""): an employee needs no HR permission to see their own
    // profile, leave, attendance and payslips, so "not permitted" is not a refusal there. A module
    // that is disabled or not in the plan still is.
    if (!(permission === "" && (error as { code?: string }).code === "MODULE_NOT_PERMITTED")) throw error;
  }
  // permission "" = employee self-service: any signed-in member of the workspace; the domain then
  // scopes every read and write to the caller's own employee record.
  if (permission) requireSessionPermission(session, permission);
  if (options.mutation) await requireBillingWriteAccess(client, session.organizationId, process.env);
}

export function hrContext(session: WorkspaceSessionContext) {
  return domainContext(session as unknown as Record<string, unknown>);
}
