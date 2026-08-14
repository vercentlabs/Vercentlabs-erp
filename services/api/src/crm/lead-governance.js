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
  const e = email(input.email),
    p = phone(input.mobile || input.phone),
    n = normal(
      `${input.firstName || input.first_name || ""}${input.lastName || input.last_name || ""}`,
    ),
    c = normal(input.companyName || input.company_name);
  if (!e && !p && !n) return [];
  const r = await client.query(
    `SELECT id,code,full_name,email,mobile,phone,company_name,status,((CASE WHEN $2<>'' AND normalized_email=$2 THEN 70 ELSE 0 END)+(CASE WHEN $3<>'' AND normalized_phone=$3 THEN 55 ELSE 0 END)+(CASE WHEN $4<>'' AND regexp_replace(lower(coalesce(full_name,'')),'[^a-z0-9]+','','g')=$4 THEN 25 ELSE 0 END)+(CASE WHEN $5<>'' AND regexp_replace(lower(coalesce(company_name,'')),'[^a-z0-9]+','','g')=$5 THEN 15 ELSE 0 END))::int match_score FROM tenant.crm_leads WHERE organization_id=$1 AND status NOT IN ('archived','converted') AND ($6::uuid IS NULL OR id<>$6) AND (($2<>'' AND normalized_email=$2) OR ($3<>'' AND normalized_phone=$3) OR ($4<>'' AND regexp_replace(lower(coalesce(full_name,'')),'[^a-z0-9]+','','g')=$4)) ORDER BY match_score DESC,updated_at DESC LIMIT 25`,
    [context.organizationId, e, p, n, c, excludeId],
  );
  return r.rows;
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
        AND lead.status NOT IN ('converted','archived')
      GROUP BY candidate.user_id
      ORDER BY count(lead.id) ASC,candidate.user_id ASC
      LIMIT 1`,
    [context.organizationId, candidates],
  );
  return result.rows[0]?.user_id ? String(result.rows[0].user_id) : null;
}

async function ownerForLeadPolicy(client, context, policy) {
  if (policy.mode === 'fixed') return policy.assignee_user_id || null;
  if (policy.mode === 'round_robin') {
    const members = policy.member_user_ids || [];
    if (!members.length) return null;
    const state = await client.query(
      `INSERT INTO tenant.crm_lead_assignment_state(organization_id,policy_id,next_index)
       VALUES($1,$2,1)
       ON CONFLICT(organization_id,policy_id)
       DO UPDATE SET next_index=tenant.crm_lead_assignment_state.next_index+1,updated_at=now()
       RETURNING next_index`,
      [context.organizationId,policy.id],
    );
    return members[(Number(state.rows[0]?.next_index || 1)-1)%members.length] || null;
  }
  if (policy.mode === 'workload')
    return leastLoadedLeadOwner(client,context,policy.member_user_ids || []);
  if (policy.mode === 'territory') {
    const members=await activeTerritoryUserIds(client,context,policy.territory_id);
    return leastLoadedLeadOwner(client,context,members);
  }
  return null;
}

export async function resolveLeadOwner(client, context, input) {
  const result=await client.query(
    `SELECT * FROM tenant.crm_lead_assignment_policies
      WHERE organization_id=$1 AND status='active'
      ORDER BY sequence,id FOR UPDATE`,
    [context.organizationId],
  );
  for (const policy of result.rows) {
    if (!matches(policy.criteria,input)) continue;
    const owner=await ownerForLeadPolicy(client,context,policy);
    if (owner) return owner;
  }
  return input.ownerUserId || input.owner_user_id || null;
}

export async function listLeadAssignmentPolicies(client, context) {
  const result=await client.query(
    `SELECT policy.*,assignee.full_name AS assignee_name,territory.name AS territory_name
       FROM tenant.crm_lead_assignment_policies policy
       LEFT JOIN public.users assignee ON assignee.id=policy.assignee_user_id
       LEFT JOIN tenant.crm_territories territory
         ON territory.organization_id=policy.organization_id
        AND territory.id=policy.territory_id
      WHERE policy.organization_id=$1 AND policy.status='active'
      ORDER BY policy.sequence,policy.name`,
    [context.organizationId],
  );
  return result.rows;
}

export async function saveLeadAssignmentPolicy(client, context, input = {}) {
  const id=text(input.id);
  const name=text(input.name).slice(0,160);
  const mode=text(input.mode);
  const sequence=Number.isFinite(Number(input.sequence)) ? Number(input.sequence) : 100;
  const criteria=input.criteria && typeof input.criteria==='object' && !Array.isArray(input.criteria) ? input.criteria : {};
  const assigneeUserId=text(input.assigneeUserId) || null;
  const memberUserIds=Array.isArray(input.memberUserIds)
    ? [...new Set(input.memberUserIds.map(text).filter(Boolean))]
    : [];
  const territoryId=text(input.territoryId) || null;
  if (!name) throw new LeadGovernanceError(400,'Assignment-policy name is required.');
  if (!['fixed','round_robin','territory','workload'].includes(mode))
    throw new LeadGovernanceError(400,'Unsupported lead-assignment mode.');
  if (mode==='fixed' && !assigneeUserId)
    throw new LeadGovernanceError(400,'Fixed assignment requires an assignee.');
  if (['round_robin','workload'].includes(mode) && !memberUserIds.length)
    throw new LeadGovernanceError(400,`${mode.replace('_',' ')} assignment requires at least one member.`);
  if (mode==='territory' && !territoryId)
    throw new LeadGovernanceError(400,'Territory assignment requires a territory.');
  const result=id
    ? await client.query(
        `UPDATE tenant.crm_lead_assignment_policies
            SET name=$3,sequence=$4,criteria=$5::jsonb,mode=$6,
                assignee_user_id=$7,member_user_ids=$8::uuid[],territory_id=$9,
                updated_by=$2,updated_at=now()
          WHERE organization_id=$1 AND id=$10 AND status='active'
          RETURNING *`,
        [context.organizationId,context.userId,name,sequence,JSON.stringify(criteria),mode,assigneeUserId,memberUserIds,territoryId,id],
      )
    : await client.query(
        `INSERT INTO tenant.crm_lead_assignment_policies(
           organization_id,name,sequence,criteria,mode,assignee_user_id,
           member_user_ids,territory_id,status,created_by,updated_by
         ) VALUES($1,$3,$4,$5::jsonb,$6,$7,$8::uuid[],$9,'active',$2,$2)
         RETURNING *`,
        [context.organizationId,context.userId,name,sequence,JSON.stringify(criteria),mode,assigneeUserId,memberUserIds,territoryId],
      );
  if (!result.rows[0]) throw new LeadGovernanceError(404,'Assignment policy not found.');
  return result.rows[0];
}

export async function archiveLeadAssignmentPolicy(client, context, policyId) {
  const result=await client.query(
    `UPDATE tenant.crm_lead_assignment_policies
        SET status='inactive',updated_by=$2,updated_at=now()
      WHERE organization_id=$1 AND id=$3 AND status='active'
      RETURNING *`,
    [context.organizationId,context.userId,policyId],
  );
  if (!result.rows[0]) throw new LeadGovernanceError(404,'Assignment policy not found.');
  return result.rows[0];
}
