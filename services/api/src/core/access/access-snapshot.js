// WorkspaceAccessSnapshot: everything the shared authorization layer needs
// about one principal in one workspace, resolved ONCE per request/render.
//
// Never persisted and never shared across requests — a role, permission,
// module or subscription change is effective on the very next request.
// Cache it only for the lifetime of one request (the web layer uses React
// cache(); a worker job builds one per job).
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";

import { getBillingSummary } from "../billing/index.js";
import { evaluateModuleAccess, getEnabledModuleKeys, isModulePermitted } from "../module-entitlements.js";
import { listAccessibleCompanies } from "../session.js";
import { createAccessPrincipal } from "./principal.js";

function subscriptionView(summary) {
  if (!summary) return null;
  return Object.freeze({
    status: summary.status ?? null,
    planCode: summary.planCode ?? null,
    writeAccess: Boolean(summary.writeAccess),
    enforcementMode: summary.enforcementMode ?? null,
    seats: summary.seats ?? null,
    seatOverage: summary.seatOverage ?? null,
  });
}

// Pure assembly — unit-testable without a database.
export function assembleWorkspaceAccessSnapshot({ session, companies, enabledModuleKeys, billingSummary, now = new Date() }) {
  const companyList = (companies || []).map((company) =>
    Object.freeze({ id: company.id, name: company.name ?? null }),
  );
  const branchList = (companies || []).flatMap((company) =>
    (company.branches || []).map((branch) => Object.freeze({ id: branch.id, name: branch.name ?? null, companyId: branch.company_id ?? branch.companyId ?? company.id })),
  );
  const principal = createAccessPrincipal(session, {
    companyIds: companyList.map((company) => company.id),
    branchIds: branchList.map((branch) => branch.id),
  });
  const modules = ERP_MODULE_CATALOG.map((module) =>
    Object.freeze(
      evaluateModuleAccess({
        moduleId: module.key,
        enabledModuleKeys,
        billingSummary,
        permitted: isModulePermitted(principal, module.key),
      }),
    ),
  );
  const keys = (predicate) => Object.freeze(modules.filter(predicate).map((entry) => entry.moduleId));
  return Object.freeze({
    principal,
    subscription: subscriptionView(billingSummary),
    modules: Object.freeze(modules),
    enabledModules: keys((entry) => entry.enabled),
    entitledModules: keys((entry) => entry.entitled),
    accessibleModules: keys((entry) => entry.accessible),
    companies: Object.freeze(companyList),
    branches: Object.freeze(branchList),
    generatedAt: now.toISOString(),
  });
}

// Issues its queries sequentially on the one supplied client (a pg client
// runs one query at a time). Every lookup fails closed.
export async function buildWorkspaceAccessSnapshot(client, session, { env = process.env, now } = {}) {
  // Validates the session first so a missing workspace fails before any query.
  createAccessPrincipal(session);
  let enabledModuleKeys;
  try {
    enabledModuleKeys = await getEnabledModuleKeys(client, session.organizationId);
  } catch {
    enabledModuleKeys = null;
  }
  let billingSummary;
  try {
    billingSummary = await getBillingSummary(client, session.organizationId, env);
  } catch {
    billingSummary = null;
  }
  let companies;
  try {
    companies = await listAccessibleCompanies(client, session.organizationId, session.userId);
  } catch {
    companies = [];
  }
  return assembleWorkspaceAccessSnapshot({ session, companies, enabledModuleKeys, billingSummary, now });
}
