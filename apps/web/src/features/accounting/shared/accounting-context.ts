import "server-only";

import { HttpError } from "@/core/http";
import type { WorkspaceSessionContext } from "@/core/session";

export function accountingContext(session: WorkspaceSessionContext) {
  const raw = session as unknown as Record<string, unknown>;
  const activeCompanyId = String(raw.activeCompanyId || raw.companyId || "");
  if (!activeCompanyId) throw new HttpError(400, "Select an active company before using Accounting.", "ACTIVE_COMPANY_REQUIRED");
  return {
    organizationId: session.organizationId,
    userId: String(raw.userId),
    activeCompanyId,
    activeBranchId: (raw.activeBranchId as string | null | undefined) ?? null,
    allowAllCompanies: false,
    permissions: (raw.permissions as string[] | undefined) ?? [],
    roleSlugs: (raw.roleSlugs as string[] | undefined) ?? [],
  };
}
