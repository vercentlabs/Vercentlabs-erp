import type { SessionContext } from "@/core/auth";
import { HttpError } from "@/core/http";
import { SalesError } from "@vercentlabs/api";

export function salesContext(session: SessionContext) {
  return {
    organizationId: String(session.organizationId),
    userId: session.userId,
    activeCompanyId: session.activeCompanyId,
    activeBranchId: session.activeBranchId,
    allowAllCompanies:
      session.roleSlugs.includes("organization_owner") ||
      session.roleSlugs.includes("system_administrator") ||
      session.roleSlugs.includes("company_administrator"),
    permissions: session.permissions,
    roleSlugs: session.roleSlugs,
  };
}
export function rethrowSalesError(error: unknown): never {
  if (error instanceof SalesError) throw new HttpError(error.status, error.message);
  throw error;
}
