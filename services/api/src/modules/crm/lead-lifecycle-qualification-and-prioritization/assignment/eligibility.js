// F005 Lead assignment — eligibility primitives: who may receive a Lead
// (CRM access + company/branch scope + active membership), who is
// currently unavailable (out-of-office), least-loaded/territory candidate
// resolution, and — new in CRM vNext Prompt 4 — a full per-candidate
// explain trace so "why did this owner win" is reconstructible for
// support/audit rather than a single opaque policy-mode label.
import { LeadGovernanceError, text, UUID } from "./shared.js";

export function assigneeScopeSql(companyParameter, branchParameter) {
  const unrestricted = `EXISTS (
    SELECT 1 FROM public.user_role_assignments unrestricted_assignment
    JOIN public.roles unrestricted_role
      ON unrestricted_role.organization_id=unrestricted_assignment.organization_id
     AND unrestricted_role.id=unrestricted_assignment.role_id
     AND unrestricted_role.status='active'
     AND unrestricted_role.slug IN ('organization_owner','system_administrator')
    WHERE unrestricted_assignment.organization_id=membership.organization_id
      AND unrestricted_assignment.user_id=membership.user_id
      AND unrestricted_assignment.status='active'
      AND unrestricted_assignment.starts_at<=now()
      AND (unrestricted_assignment.expires_at IS NULL OR unrestricted_assignment.expires_at>now())
  )`;
  return `AND ($${companyParameter}::uuid IS NULL OR ${unrestricted} OR EXISTS (
      SELECT 1 FROM public.membership_company_access company_access
       WHERE company_access.organization_id=membership.organization_id
         AND company_access.user_id=membership.user_id
         AND company_access.company_id=$${companyParameter}
    ))
    AND ($${branchParameter}::uuid IS NULL OR ${unrestricted} OR EXISTS (
      SELECT 1 FROM public.membership_branch_access branch_access
       WHERE branch_access.organization_id=membership.organization_id
         AND branch_access.user_id=membership.user_id
         AND branch_access.branch_id=$${branchParameter}
    ))`;
}

export function crmEligibleSql() {
  return `EXISTS (
    SELECT 1 FROM public.user_role_assignments assignment
    JOIN public.roles role
      ON role.organization_id=assignment.organization_id
     AND role.id=assignment.role_id
     AND role.status='active'
    LEFT JOIN public.role_permissions permission
      ON permission.role_id=role.id AND permission.permission_key='crm.view'
    WHERE assignment.organization_id=membership.organization_id
      AND assignment.user_id=membership.user_id
      AND assignment.status='active'
      AND assignment.starts_at<=now()
      AND (assignment.expires_at IS NULL OR assignment.expires_at>now())
      AND (role.slug='organization_owner' OR permission.permission_key IS NOT NULL)
  )`;
}

export async function getEligibleLeadAssignee(client, context, userId, scope = {}) {
  if (!UUID.test(String(userId || ""))) return null;
  const result = await client.query(
    `SELECT user_account.id,user_account.full_name AS name,user_account.email
       FROM public.organization_memberships membership
       JOIN public.users user_account ON user_account.id=membership.user_id
      WHERE membership.organization_id=$1 AND membership.user_id=$2
        AND membership.status='active' AND user_account.status='active'
        AND ${crmEligibleSql()} ${assigneeScopeSql(3, 4)}
      LIMIT 1`,
    [context.organizationId, userId, scope.companyId || null, scope.branchId || null],
  );
  return result.rows[0] || null;
}

export async function assertEligibleLeadAssignee(client, context, userId, scope = {}) {
  const assignee = await getEligibleLeadAssignee(client, context, userId, scope);
  if (!assignee)
    throw new LeadGovernanceError(
      409,
      "The selected owner is not an active, eligible CRM member for this company and branch.",
      "CRM_LEAD_ASSIGNEE_SCOPE_INVALID",
    );
  return assignee;
}

export async function listEligibleLeadAssignees(client, context, input = {}) {
  const search = text(input.search).slice(0, 120);
  const limit = Math.min(50, Math.max(1, Number(input.limit) || 20));
  const offset = Math.min(100000, Math.max(0, Number(input.offset) || 0));
  const values = [context.organizationId, input.companyId || context.activeCompanyId || null, input.branchId || context.activeBranchId || null, search];
  const where = `membership.organization_id=$1 AND membership.status='active'
    AND user_account.status='active' AND ${crmEligibleSql()} ${assigneeScopeSql(2, 3)}
    AND ($4='' OR user_account.full_name ILIKE '%'||$4||'%' OR user_account.email ILIKE '%'||$4||'%')`;
  // Sequential, not Promise.all — concurrent client.query() on one shared
  // PoolClient can interleave extended-query protocol messages (observed
  // live as Postgres 08P01 "bind message supplies N parameters..."); see
  // opportunity-revenue-intelligence.js's fix for the full explanation.
  const items = await client.query(
    `SELECT user_account.id,user_account.full_name AS name,user_account.email
       FROM public.organization_memberships membership
       JOIN public.users user_account ON user_account.id=membership.user_id
      WHERE ${where} ORDER BY user_account.full_name,user_account.id LIMIT $5 OFFSET $6`,
    [...values, limit, offset],
  );
  const count = await client.query(
    `SELECT count(*)::int AS total FROM public.organization_memberships membership
     JOIN public.users user_account ON user_account.id=membership.user_id WHERE ${where}`,
    values,
  );
  return { items: items.rows, total: Number(count.rows[0]?.total || 0), limit, offset };
}

// F005: excludes a candidate currently marked out-of-office
// (crm_lead_assignee_availability) from automatic assignment pools —
// round-robin, workload and territory routing all resolve their member
// list through this same function, so this one clause covers all three.
export function availabilitySql(alias) {
  return `AND NOT EXISTS (
    SELECT 1 FROM tenant.crm_lead_assignee_availability away
     WHERE away.organization_id=$1 AND away.user_id=${alias}.user_id
       AND away.starts_at<=now() AND away.ends_at>now()
  )`;
}

// F005: only automatic, policy-driven assignment (round-robin, workload,
// territory, and this fixed-mode check) skips an out-of-office candidate.
// A manager explicitly picking a specific owner (assignLeadOwner,
// createCrmRecord's ownerUserId) is a deliberate override and is
// unaffected — availability is a routing signal, not a hard block on
// human judgment.
export async function isLeadAssigneeAvailable(client, context, userId) {
  const result = await client.query(
    `SELECT 1 FROM tenant.crm_lead_assignee_availability
      WHERE organization_id=$1 AND user_id=$2 AND starts_at<=now() AND ends_at>now() LIMIT 1`,
    [context.organizationId, userId],
  );
  return !result.rows[0];
}

export async function activeTerritoryUserIds(client, context, territoryId) {
  if (!territoryId) return [];
  const result = await client.query(
    `SELECT territory_user.user_id FROM (
       SELECT DISTINCT assignment.assignee_id AS user_id
         FROM tenant.crm_territory_assignments assignment
         JOIN public.organization_memberships membership
           ON membership.organization_id=assignment.organization_id
          AND membership.user_id=assignment.assignee_id
          AND membership.status='active'
        WHERE assignment.organization_id=$1
          AND assignment.territory_id=$2
          AND assignment.assignee_type='user'
          AND assignment.effective_from<=current_date
          AND (assignment.effective_to IS NULL OR assignment.effective_to>=current_date)
        UNION
        SELECT territory.manager_user_id AS user_id
          FROM tenant.crm_territories territory
          JOIN public.organization_memberships membership
            ON membership.organization_id=territory.organization_id
           AND membership.user_id=territory.manager_user_id
           AND membership.status='active'
         WHERE territory.organization_id=$1
           AND territory.id=$2
           AND territory.manager_user_id IS NOT NULL
     ) territory_user
     WHERE NOT EXISTS (
       SELECT 1 FROM tenant.crm_lead_assignee_availability away
        WHERE away.organization_id=$1 AND away.user_id=territory_user.user_id
          AND away.starts_at<=now() AND away.ends_at>now()
     )`,
    [context.organizationId, territoryId],
  );
  return result.rows.map((row) => String(row.user_id)).filter(Boolean);
}

export async function leastLoadedLeadOwner(client, context, candidateIds) {
  const candidates = [...new Set((candidateIds || []).map(String).filter(Boolean))];
  if (!candidates.length) return null;
  const result = await client.query(
    `WITH candidate(user_id) AS (SELECT unnest($2::uuid[]))
     SELECT candidate.user_id,count(lead.id)::int AS active_leads
       FROM candidate
       JOIN public.organization_memberships membership
         ON membership.organization_id=$1
        AND membership.user_id=candidate.user_id
        AND membership.status='active'
       LEFT JOIN tenant.crm_leads lead
         ON lead.organization_id=$1
        AND lead.owner_user_id=candidate.user_id
        AND lead.record_status='active'
      GROUP BY candidate.user_id
      ORDER BY count(lead.id) ASC,candidate.user_id ASC
      LIMIT 1`,
    [context.organizationId, candidates],
  );
  return result.rows[0]?.user_id ? String(result.rows[0].user_id) : null;
}

export async function eligiblePolicyMemberIds(client, context, memberUserIds, input) {
  const members = [...new Set((memberUserIds || []).map(String).filter(Boolean))];
  if (!members.length) return [];
  const result = await client.query(
    `SELECT candidate.user_id FROM unnest($2::uuid[]) WITH ORDINALITY candidate(user_id,position)
       JOIN public.organization_memberships membership
         ON membership.organization_id=$1 AND membership.user_id=candidate.user_id AND membership.status='active'
       JOIN public.users user_account ON user_account.id=membership.user_id AND user_account.status='active'
      WHERE ${crmEligibleSql()} ${assigneeScopeSql(3, 4)} ${availabilitySql("candidate")} ORDER BY candidate.position`,
    [context.organizationId, members, input.companyId || input.company_id || null, input.branchId || input.branch_id || null],
  );
  return result.rows.map((row) => String(row.user_id));
}

// F005-CAP-001 explainability: given the same candidate pool a policy
// would use, return every candidate with an eligible/excluded verdict and
// a human-readable reason — not just the filtered eligible subset. Bounded
// to the policy's own member_user_ids array (never a full user scan), so
// this carries no extra performance cost beyond the existing eligibility
// check it mirrors.
export async function explainLeadAssignmentCandidates(client, context, memberUserIds, input) {
  const members = [...new Set((memberUserIds || []).map(String).filter(Boolean))];
  if (!members.length) return [];
  const unrestricted = `EXISTS (
    SELECT 1 FROM public.user_role_assignments unrestricted_assignment
    JOIN public.roles unrestricted_role
      ON unrestricted_role.organization_id=unrestricted_assignment.organization_id
     AND unrestricted_role.id=unrestricted_assignment.role_id
     AND unrestricted_role.status='active'
     AND unrestricted_role.slug IN ('organization_owner','system_administrator')
    WHERE unrestricted_assignment.organization_id=$1
      AND unrestricted_assignment.user_id=candidate.user_id
      AND unrestricted_assignment.status='active'
      AND unrestricted_assignment.starts_at<=now()
      AND (unrestricted_assignment.expires_at IS NULL OR unrestricted_assignment.expires_at>now())
  )`;
  const result = await client.query(
    `SELECT candidate.user_id,
            (membership.user_id IS NOT NULL) AS is_member,
            (user_account.id IS NOT NULL AND user_account.status='active') AS user_active,
            COALESCE(user_account.full_name,user_account.email) AS name,
            CASE WHEN membership.user_id IS NULL THEN false ELSE EXISTS (
              SELECT 1 FROM public.user_role_assignments assignment
              JOIN public.roles role
                ON role.organization_id=assignment.organization_id
               AND role.id=assignment.role_id
               AND role.status='active'
              LEFT JOIN public.role_permissions permission
                ON permission.role_id=role.id AND permission.permission_key='crm.view'
              WHERE assignment.organization_id=$1
                AND assignment.user_id=candidate.user_id
                AND assignment.status='active'
                AND assignment.starts_at<=now()
                AND (assignment.expires_at IS NULL OR assignment.expires_at>now())
                AND (role.slug='organization_owner' OR permission.permission_key IS NOT NULL)
            ) END AS crm_eligible,
            CASE WHEN membership.user_id IS NULL THEN false ELSE (
              ($3::uuid IS NULL OR ${unrestricted} OR EXISTS (
                SELECT 1 FROM public.membership_company_access company_access
                 WHERE company_access.organization_id=$1 AND company_access.user_id=candidate.user_id AND company_access.company_id=$3
              ))
              AND ($4::uuid IS NULL OR ${unrestricted} OR EXISTS (
                SELECT 1 FROM public.membership_branch_access branch_access
                 WHERE branch_access.organization_id=$1 AND branch_access.user_id=candidate.user_id AND branch_access.branch_id=$4
              ))
            ) END AS in_scope,
            EXISTS (
              SELECT 1 FROM tenant.crm_lead_assignee_availability away
               WHERE away.organization_id=$1 AND away.user_id=candidate.user_id
                 AND away.starts_at<=now() AND away.ends_at>now()
            ) AS out_of_office
       FROM unnest($2::uuid[]) WITH ORDINALITY candidate(user_id,position)
       LEFT JOIN public.organization_memberships membership
         ON membership.organization_id=$1 AND membership.user_id=candidate.user_id AND membership.status='active'
       LEFT JOIN public.users user_account ON user_account.id=candidate.user_id
      ORDER BY candidate.position`,
    [context.organizationId, members, input.companyId || input.company_id || null, input.branchId || input.branch_id || null],
  );
  return result.rows.map((row) => {
    const reasons = [];
    if (!row.is_member || !row.user_active) reasons.push("Inactive user");
    if (row.is_member && !row.crm_eligible) reasons.push("No CRM access");
    if (row.is_member && !row.in_scope) reasons.push("Outside branch/territory scope");
    if (row.out_of_office) reasons.push("Out of office");
    const eligible = row.is_member && row.user_active && row.crm_eligible && row.in_scope && !row.out_of_office;
    return { userId: String(row.user_id), name: row.name || null, eligible, reasons };
  });
}
