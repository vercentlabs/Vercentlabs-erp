import "server-only";

import { HttpError } from "../../../core/http-errors.ts";
import type { WorkspaceSessionContext } from "@/core/session";

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
