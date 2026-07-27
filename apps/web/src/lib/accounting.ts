import { AccountingError } from "@vercentlabs/api";
import type { SessionContext } from "@/lib/auth";
import { HttpError } from "@/lib/http";

export function accountingContext(session: SessionContext) {
  return {
    organizationId: String(session.organizationId),
    userId: session.userId,
    activeCompanyId: session.activeCompanyId,
    activeBranchId: session.activeBranchId,
    allowAllCompanies: session.roleSlugs.some((role) => ["organization_owner", "system_administrator", "company_administrator"].includes(role)),
    permissions: session.permissions,
    roleSlugs: session.roleSlugs,
  };
}

export function rethrowAccountingError(error: unknown): never {
  if (error instanceof AccountingError) throw new HttpError(error.status, error.message);
  throw error;
}
