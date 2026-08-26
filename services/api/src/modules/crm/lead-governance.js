import { evaluateLeadDuplicateRisk } from "./lead-duplicates.js";

export class LeadGovernanceError extends Error {
  constructor(
    status,
    message,
    code = "CRM_LEAD_GOVERNANCE_ERROR",
    details = [],
  ) {
    super(message);
    this.name = "LeadGovernanceError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const text = (v) => String(v ?? "").trim();
const normal = (v) =>
  text(v)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
const email = (v) => text(v).toLowerCase();
const phone = (v) => text(v).replace(/\D+/g, "").slice(-15);
function matches(criteria, input) {
  return Object.entries(criteria || {}).every(([k, v]) =>
    Array.isArray(v)
      ? v.map(String).includes(String(input[k] ?? ""))
      : String(input[k] ?? "") === String(v),
  );
}
export async function getLeadConfiguration(
  client,
  context,
  recordTypeKey = "standard",
) {
  const rt = await client.query(
    `SELECT * FROM tenant.crm_lead_record_types WHERE organization_id=$1 AND key=$2 AND status='active' LIMIT 1`,
    [context.organizationId, recordTypeKey],
  );
  if (!rt.rows[0])
    throw new LeadGovernanceError(
      404,
      "Lead record type not found.",
      "CRM_LEAD_RECORD_TYPE_NOT_FOUND",
    );
  const [fields, layouts, policies] = await Promise.all([
    client.query(
      `SELECT field_key,label,data_type,storage,standard_column,help_text,placeholder,options,default_value,required,searchable,unique_value FROM tenant.crm_lead_field_definitions WHERE organization_id=$1 AND status='active' ORDER BY created_at,id`,
      [context.organizationId],
    ),
    client.query(
      `SELECT id,name,sections,visibility_rules,validation_rules FROM tenant.crm_lead_layouts WHERE organization_id=$1 AND record_type_id=$2 AND status='active' ORDER BY created_at LIMIT 1`,
      [context.organizationId, rt.rows[0].id],
    ),
    client.query(
      `SELECT id,name,sequence,criteria,mode,assignee_user_id,member_user_ids,territory_id FROM tenant.crm_lead_assignment_policies WHERE organization_id=$1 AND status='active' ORDER BY sequence,id`,
      [context.organizationId],
    ),
  ]);
  return {
    recordType: rt.rows[0],
    fields: fields.rows,
    layout: layouts.rows[0] || null,
    assignmentPolicies: policies.rows,
  };
}
export async function validateLeadInput(
  client,
  context,
  input,
  recordTypeKey = "standard",
) {
  const config = await getLeadConfiguration(client, context, recordTypeKey);
  const errors = [];
  const custom =
    input.customData && typeof input.customData === "object"
      ? input.customData
      : {};
  for (const f of config.fields) {
    const value =
      f.storage === "standard" ? input[f.standard_column] : custom[f.field_key];
    if (
      f.required &&
      (value === null || value === undefined || text(value) === "")
    )
      errors.push({ field: f.field_key, message: `${f.label} is required.` });
    if (value != null && text(value) !== "") {
      if (
        f.data_type === "email" &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(value))
      )
        errors.push({
          field: f.field_key,
          message: `${f.label} must be a valid email.`,
        });
      if (f.data_type === "url") {
        try {
          new URL(text(value));
        } catch {
          errors.push({
            field: f.field_key,
            message: `${f.label} must be a valid URL.`,
          });
        }
      }
      if (f.data_type === "number" || f.data_type === "currency") {
        if (!Number.isFinite(Number(value)))
          errors.push({
            field: f.field_key,
            message: `${f.label} must be numeric.`,
          });
      }
      if (
        f.data_type === "picklist" &&
        Array.isArray(f.options) &&
        !f.options.map(String).includes(String(value))
      )
        errors.push({
          field: f.field_key,
          message: `${f.label} has an invalid option.`,
        });
    }
  }
  for (const rule of config.layout?.validation_rules || []) {
    if (
      rule.when &&
      matches(rule.when, input) &&
      rule.require &&
      !text(input[rule.require])
    )
      errors.push({
        field: rule.require,
        message: rule.message || `${rule.require} is required.`,
      });
  }
  return { valid: errors.length === 0, errors, configuration: config };
}
export async function findLeadDuplicates(
  client,
  context,
  input,
  excludeId = null,
) {
  const evaluation = await evaluateLeadDuplicateRisk(client, context, input, {
    excludeLeadId: excludeId,
    lock: false,
  });
  return evaluation.matches;
}

async function activeTerritoryUserIds(client, context, territoryId) {
  if (!territoryId) return [];
  const result = await client.query(
    `SELECT DISTINCT assignment.assignee_id AS user_id
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
         AND territory.manager_user_id IS NOT NULL`,
    [context.organizationId, territoryId],
  );
  return result.rows.map((row) => String(row.user_id)).filter(Boolean);
}

async function leastLoadedLeadOwner(client, context, candidateIds) {
  const candidates = [
    ...new Set((candidateIds || []).map(String).filter(Boolean)),
  ];
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

const LEAD_ASSIGNMENT_CRITERIA_FIELDS = new Set([
  "sourceId",
  "countryCode",
  "industry",
  "productInterest",
]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeLeadAssignmentCriteria(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new LeadGovernanceError(
      400,
      "Assignment-rule conditions must be an object.",
      "CRM_ASSIGNMENT_RULE_INVALID",
    );
  const criteria = {};
  for (const [field, raw] of Object.entries(value)) {
    if (!LEAD_ASSIGNMENT_CRITERIA_FIELDS.has(field))
      throw new LeadGovernanceError(
        400,
        `Unsupported assignment condition: ${field}.`,
        "CRM_ASSIGNMENT_RULE_INVALID",
      );
    const normalized = text(raw).slice(0, 500);
    if (!normalized)
      throw new LeadGovernanceError(
        400,
        `Assignment condition ${field} cannot be empty.`,
        "CRM_ASSIGNMENT_RULE_INVALID",
      );
    if (field === "sourceId" && !UUID.test(normalized))
      throw new LeadGovernanceError(
        400,
        "Assignment-rule Lead Source is invalid.",
        "CRM_ASSIGNMENT_RULE_INVALID",
      );
    if (field === "countryCode" && !/^[A-Za-z]{2}$/.test(normalized))
      throw new LeadGovernanceError(
        400,
        "Assignment-rule country must use a two-letter code.",
        "CRM_ASSIGNMENT_RULE_INVALID",
      );
    criteria[field] =
      field === "countryCode" ? normalized.toUpperCase() : normalized;
  }
  return criteria;
}

function assigneeScopeSql(companyParameter, branchParameter) {
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

function crmEligibleSql() {
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

export async function getEligibleLeadAssignee(
  client,
  context,
  userId,
  scope = {},
) {
  if (!UUID.test(String(userId || ""))) return null;
  const result = await client.query(
    `SELECT user_account.id,user_account.full_name AS name,user_account.email
       FROM public.organization_memberships membership
       JOIN public.users user_account ON user_account.id=membership.user_id
      WHERE membership.organization_id=$1 AND membership.user_id=$2
        AND membership.status='active' AND user_account.status='active'
        AND ${crmEligibleSql()} ${assigneeScopeSql(3, 4)}
      LIMIT 1`,
    [
      context.organizationId,
      userId,
      scope.companyId || null,
      scope.branchId || null,
    ],
  );
  return result.rows[0] || null;
}

export async function assertEligibleLeadAssignee(
  client,
  context,
  userId,
  scope = {},
) {
  const assignee = await getEligibleLeadAssignee(
    client,
    context,
    userId,
    scope,
  );
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
  const values = [
    context.organizationId,
    input.companyId || context.activeCompanyId || null,
    input.branchId || context.activeBranchId || null,
    search,
  ];
  const where = `membership.organization_id=$1 AND membership.status='active'
    AND user_account.status='active' AND ${crmEligibleSql()} ${assigneeScopeSql(2, 3)}
    AND ($4='' OR user_account.full_name ILIKE '%'||$4||'%' OR user_account.email ILIKE '%'||$4||'%')`;
  const [items, count] = await Promise.all([
    client.query(
      `SELECT user_account.id,user_account.full_name AS name,user_account.email
         FROM public.organization_memberships membership
         JOIN public.users user_account ON user_account.id=membership.user_id
        WHERE ${where} ORDER BY user_account.full_name,user_account.id LIMIT $5 OFFSET $6`,
      [...values, limit, offset],
    ),
    client.query(
      `SELECT count(*)::int AS total FROM public.organization_memberships membership
       JOIN public.users user_account ON user_account.id=membership.user_id WHERE ${where}`,
      values,
    ),
  ]);
  return {
    items: items.rows,
    total: Number(count.rows[0]?.total || 0),
    limit,
    offset,
  };
}

async function eligiblePolicyMemberIds(client, context, memberUserIds, input) {
  const members = [
    ...new Set((memberUserIds || []).map(String).filter(Boolean)),
  ];
  if (!members.length) return [];
  const result = await client.query(
    `SELECT candidate.user_id FROM unnest($2::uuid[]) WITH ORDINALITY candidate(user_id,position)
       JOIN public.organization_memberships membership
         ON membership.organization_id=$1 AND membership.user_id=candidate.user_id AND membership.status='active'
       JOIN public.users user_account ON user_account.id=membership.user_id AND user_account.status='active'
      WHERE ${crmEligibleSql()} ${assigneeScopeSql(3, 4)} ORDER BY candidate.position`,
    [
      context.organizationId,
      members,
      input.companyId || input.company_id || null,
      input.branchId || input.branch_id || null,
    ],
  );
  return result.rows.map((row) => String(row.user_id));
}

async function ownerForLeadPolicy(client, context, policy, input) {
  if (policy.mode === "fixed") {
    const assignee = await getEligibleLeadAssignee(
      client,
      context,
      policy.assignee_user_id,
      {
        companyId: input.companyId || input.company_id || null,
        branchId: input.branchId || input.branch_id || null,
      },
    );
    return assignee?.id || null;
  }
  if (policy.mode === "round_robin") {
    const members = await eligiblePolicyMemberIds(
      client,
      context,
      policy.member_user_ids,
      input,
    );
    if (!members.length) return null;
    await client.query(
      `INSERT INTO tenant.crm_lead_assignment_state(organization_id,policy_id,next_index)
       VALUES($1,$2,0) ON CONFLICT(organization_id,policy_id) DO NOTHING`,
      [context.organizationId, policy.id],
    );
    const state = await client.query(
      `SELECT next_index FROM tenant.crm_lead_assignment_state WHERE organization_id=$1 AND policy_id=$2 FOR UPDATE`,
      [context.organizationId, policy.id],
    );
    const index = Number(state.rows[0]?.next_index || 0) % members.length;
    await client.query(
      `INSERT INTO tenant.crm_lead_assignment_state(organization_id,policy_id,next_index)
       VALUES($1,$2,$3) ON CONFLICT(organization_id,policy_id)
       DO UPDATE SET next_index=$3,updated_at=now()`,
      [context.organizationId, policy.id, (index + 1) % members.length],
    );
    return members[index] || null;
  }
  if (policy.mode === "workload")
    return leastLoadedLeadOwner(
      client,
      context,
      await eligiblePolicyMemberIds(
        client,
        context,
        policy.member_user_ids,
        input,
      ),
    );
  if (policy.mode === "territory")
    return leastLoadedLeadOwner(
      client,
      context,
      await activeTerritoryUserIds(client, context, policy.territory_id),
    );
  return null;
}

export async function resolveLeadAssignment(client, context, input) {
  const result = await client.query(
    `SELECT * FROM tenant.crm_lead_assignment_policies WHERE organization_id=$1 AND status='active' ORDER BY sequence,id FOR UPDATE`,
    [context.organizationId],
  );
  for (const policy of result.rows) {
    if (!matches(policy.criteria, input)) continue;
    const owner = await ownerForLeadPolicy(client, context, policy, input);
    if (owner)
      return {
        ownerUserId: String(owner),
        policyId: String(policy.id),
        reason: `policy:${policy.mode}`,
      };
  }
  return { ownerUserId: null, policyId: null, reason: "unassigned" };
}

export async function resolveLeadOwner(client, context, input) {
  return (await resolveLeadAssignment(client, context, input)).ownerUserId;
}

export async function listLeadAssignmentPolicies(client, context) {
  const result = await client.query(
    `SELECT policy.*,assignee.full_name AS assignee_name,assignee.email AS assignee_email,assignee.status AS assignee_status,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object('id',member.id,'name',member.full_name,'email',member.email) ORDER BY configured.position)
                FROM unnest(policy.member_user_ids) WITH ORDINALITY configured(user_id,position)
                JOIN public.users member ON member.id=configured.user_id
            ),'[]'::jsonb) AS members
       FROM tenant.crm_lead_assignment_policies policy
       LEFT JOIN public.users assignee ON assignee.id=policy.assignee_user_id
      WHERE policy.organization_id=$1 ORDER BY policy.sequence,policy.id`,
    [context.organizationId],
  );
  return result.rows;
}

export async function saveLeadAssignmentPolicy(client, context, input = {}) {
  const id = text(input.id);
  const name = text(input.name).slice(0, 160);
  const mode = text(input.mode);
  const sequence = Number.isFinite(Number(input.sequence))
    ? Math.trunc(Number(input.sequence))
    : 100;
  const criteria = normalizeLeadAssignmentCriteria(input.criteria || {});
  const assigneeUserId = text(input.assigneeUserId) || null;
  const memberUserIds = Array.isArray(input.memberUserIds)
    ? [...new Set(input.memberUserIds.map(text).filter(Boolean))]
    : [];
  const status = text(input.status || "active");
  if (!name)
    throw new LeadGovernanceError(
      400,
      "Assignment-rule name is required.",
      "CRM_ASSIGNMENT_RULE_INVALID",
    );
  if (sequence < 0 || sequence > 100000)
    throw new LeadGovernanceError(
      400,
      "Assignment-rule priority must be between 0 and 100000.",
      "CRM_ASSIGNMENT_RULE_INVALID",
    );
  if (!["fixed", "round_robin"].includes(mode))
    throw new LeadGovernanceError(
      400,
      "Unsupported lead-assignment mode.",
      "CRM_ASSIGNMENT_RULE_INVALID",
    );
  if (mode === "fixed" && !assigneeUserId)
    throw new LeadGovernanceError(
      400,
      "Fixed assignment requires an assignee.",
      "CRM_ASSIGNMENT_RULE_INVALID",
    );
  if (mode === "round_robin" && !memberUserIds.length)
    throw new LeadGovernanceError(
      400,
      "Round-robin assignment requires at least one member.",
      "CRM_ASSIGNMENT_RULE_INVALID",
    );
  if (!["active", "inactive"].includes(status))
    throw new LeadGovernanceError(
      400,
      "Assignment-rule status is invalid.",
      "CRM_ASSIGNMENT_RULE_INVALID",
    );
  if (criteria.sourceId) {
    const source = await client.query(
      `SELECT id FROM tenant.crm_lead_sources WHERE organization_id=$1 AND id=$2 AND status='active'`,
      [context.organizationId, criteria.sourceId],
    );
    if (!source.rows[0])
      throw new LeadGovernanceError(
        409,
        "Select an active Lead Source for this rule.",
        "CRM_ASSIGNMENT_RULE_INVALID",
      );
  }
  for (const userId of mode === "fixed" ? [assigneeUserId] : memberUserIds)
    await assertEligibleLeadAssignee(client, context, userId);
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || lower($2),0))`,
    [context.organizationId, name],
  );
  const duplicate = await client.query(
    `SELECT id FROM tenant.crm_lead_assignment_policies WHERE organization_id=$1 AND lower(name)=lower($2) AND ($3::uuid IS NULL OR id<>$3) LIMIT 1`,
    [context.organizationId, name, id || null],
  );
  if (duplicate.rows[0])
    throw new LeadGovernanceError(
      409,
      "An assignment rule with this name already exists.",
      "CRM_ASSIGNMENT_RULE_DUPLICATE",
    );
  const values = [
    context.organizationId,
    context.userId,
    name,
    sequence,
    JSON.stringify(criteria),
    mode,
    mode === "fixed" ? assigneeUserId : null,
    mode === "round_robin" ? memberUserIds : [],
    status,
  ];
  const result = id
    ? await client.query(
        `UPDATE tenant.crm_lead_assignment_policies SET name=$3,sequence=$4,criteria=$5::jsonb,mode=$6,
         assignee_user_id=$7,member_user_ids=$8::uuid[],territory_id=NULL,status=$9,updated_by=$2,updated_at=now()
         WHERE organization_id=$1 AND id=$10 RETURNING *`,
        [...values, id],
      )
    : await client.query(
        `INSERT INTO tenant.crm_lead_assignment_policies(organization_id,name,sequence,criteria,mode,assignee_user_id,member_user_ids,territory_id,status,created_by,updated_by)
         VALUES($1,$3,$4,$5::jsonb,$6,$7,$8::uuid[],NULL,$9,$2,$2) RETURNING *`,
        values,
      );
  if (!result.rows[0])
    throw new LeadGovernanceError(
      404,
      "Assignment rule not found.",
      "CRM_ASSIGNMENT_RULE_NOT_FOUND",
    );
  return result.rows[0];
}

export async function setLeadAssignmentPolicyStatus(
  client,
  context,
  policyId,
  status,
) {
  if (
    !UUID.test(String(policyId || "")) ||
    !["active", "inactive"].includes(status)
  )
    throw new LeadGovernanceError(
      400,
      "Assignment-rule status request is invalid.",
      "CRM_ASSIGNMENT_RULE_INVALID",
    );
  const policy = await client.query(
    `SELECT * FROM tenant.crm_lead_assignment_policies WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, policyId],
  );
  if (!policy.rows[0])
    throw new LeadGovernanceError(
      404,
      "Assignment rule not found.",
      "CRM_ASSIGNMENT_RULE_NOT_FOUND",
    );
  if (!["fixed", "round_robin"].includes(String(policy.rows[0].mode)))
    throw new LeadGovernanceError(
      409,
      "This legacy assignment mode is outside F005 configuration.",
      "CRM_ASSIGNMENT_RULE_INVALID",
    );
  if (status === "active") {
    const row = policy.rows[0];
    for (const userId of row.mode === "fixed"
      ? [row.assignee_user_id]
      : row.member_user_ids || [])
      await assertEligibleLeadAssignee(client, context, userId);
  }
  const result = await client.query(
    `UPDATE tenant.crm_lead_assignment_policies SET status=$3,updated_by=$2,updated_at=now() WHERE organization_id=$1 AND id=$4 RETURNING *`,
    [context.organizationId, context.userId, status, policyId],
  );
  return result.rows[0];
}

export async function archiveLeadAssignmentPolicy(client, context, policyId) {
  return setLeadAssignmentPolicyStatus(client, context, policyId, "inactive");
}
