// The worker's own "trusted system actor" context — deliberately built
// independently of apps/web's crmContext()/session-derived contexts,
// since the worker has no HTTP session at all. Least-privilege by design:
// no elevated roleSlugs, no CRM permissions — the worker's real isolation
// boundary is tenant-scoped RLS (every query runs inside
// setTenantContext(organizationId)), not a permission bypass. It does not
// need crm.records.view_all-style elevated visibility because scheduled
// handlers act on specific, already-identified rows (e.g. one overdue
// activity's own id), not on a broad "list everything" query gated by
// that permission.
//
// userId is null — there is no human actor. Every mutation this context
// makes is attributable in application-level audit trails (Part 43) as
// "system: <job type>", not as any real user, and is never presented as
// if a person performed it.
export function buildSystemContext(organizationId, { activeCompanyId = null, activeBranchId = null } = {}) {
  return Object.freeze({
    organizationId,
    userId: null,
    activeCompanyId,
    activeBranchId,
    allowAllCompanies: true, // a system job scoped to one organization legitimately needs to see across companies/branches within it — this is a scope, not a permission, and does not touch crm.records.view_all
    permissions: [],
    roleSlugs: ["system_worker"],
  });
}

export const SYSTEM_ACTOR_ROLE_SLUG = "system_worker";
