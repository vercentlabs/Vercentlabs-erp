// F005 Lead assignment — the governed assignment policy engine: criteria
// matching, per-mode owner resolution (fixed/round_robin/workload/
// territory), the fallback queue, and policy CRUD. Moved here (from the
// legacy flat lead-governance.js) as part of CRM vNext Prompt 4, which also
// unlocked territory/workload policy creation (schema already supported
// them since migration 053; only the write-layer rejected them) and added
// a full per-candidate explain trace so "why did this owner win" — and,
// symmetrically, why every other candidate did not — is reconstructible
// for support/audit rather than a single opaque policy-mode label.
import { LeadGovernanceError, text, UUID, matches } from "./shared.js";
import {
  assertEligibleLeadAssignee,
  getEligibleLeadAssignee,
  isLeadAssigneeAvailable,
  activeTerritoryUserIds,
  leastLoadedLeadOwner,
  explainLeadAssignmentCandidates,
} from "./eligibility.js";

const LEAD_ASSIGNMENT_CRITERIA_FIELDS = new Set([
  "sourceId",
  "countryCode",
  "industry",
  "productInterest",
  "leadGrade",
]);
const LEAD_GRADES = new Set(["cold", "warm", "hot", "qualified"]);
const ASSIGNMENT_MODES = new Set(["fixed", "round_robin", "workload", "territory"]);

export function normalizeLeadAssignmentCriteria(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new LeadGovernanceError(400, "Assignment-rule conditions must be an object.", "CRM_ASSIGNMENT_RULE_INVALID");
  const criteria = {};
  for (const [field, raw] of Object.entries(value)) {
    if (!LEAD_ASSIGNMENT_CRITERIA_FIELDS.has(field))
      throw new LeadGovernanceError(400, `Unsupported assignment condition: ${field}.`, "CRM_ASSIGNMENT_RULE_INVALID");
    const normalized = text(raw).slice(0, 500);
    if (!normalized)
      throw new LeadGovernanceError(400, `Assignment condition ${field} cannot be empty.`, "CRM_ASSIGNMENT_RULE_INVALID");
    if (field === "sourceId" && !UUID.test(normalized))
      throw new LeadGovernanceError(400, "Assignment-rule Lead Source is invalid.", "CRM_ASSIGNMENT_RULE_INVALID");
    if (field === "countryCode" && !/^[A-Za-z]{2}$/.test(normalized))
      throw new LeadGovernanceError(400, "Assignment-rule country must use a two-letter code.", "CRM_ASSIGNMENT_RULE_INVALID");
    if (field === "leadGrade" && !LEAD_GRADES.has(normalized.toLowerCase()))
      throw new LeadGovernanceError(400, "Assignment-rule score segment must be cold, warm, hot or qualified.", "CRM_ASSIGNMENT_RULE_INVALID");
    if (field === "countryCode") criteria[field] = normalized.toUpperCase();
    else if (field === "leadGrade") criteria[field] = normalized.toLowerCase();
    else criteria[field] = normalized;
  }
  return criteria;
}

// Resolves an owner AND records why every candidate the policy considered
// did or did not win. `candidates` is [] for fixed-mode (a single named
// assignee, not a pool) and for territory mode (candidates come from
// territory membership, not a configured array) — those two still report
// their one outcome via the caller's selectionReason.
async function ownerForLeadPolicyWithTrace(client, context, policy, input) {
  if (policy.mode === "fixed") {
    const assignee = await assertEligibleLeadAssigneeSoft(client, context, policy.assignee_user_id, input);
    if (!assignee) return { owner: null, candidates: [] };
    if (!(await isLeadAssigneeAvailable(client, context, assignee.id)))
      return { owner: null, candidates: [{ userId: assignee.id, name: assignee.name, eligible: false, reasons: ["Out of office"] }] };
    return { owner: assignee.id, candidates: [{ userId: assignee.id, name: assignee.name, eligible: true, reasons: [] }] };
  }
  if (policy.mode === "round_robin") {
    const explained = await explainLeadAssignmentCandidates(client, context, policy.member_user_ids, input);
    const members = explained.filter((row) => row.eligible).map((row) => row.userId);
    if (!members.length) return { owner: null, candidates: explained };
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
    return { owner: members[index] || null, candidates: explained };
  }
  if (policy.mode === "workload") {
    const explained = await explainLeadAssignmentCandidates(client, context, policy.member_user_ids, input);
    const owner = await leastLoadedLeadOwner(client, context, explained.filter((row) => row.eligible).map((row) => row.userId));
    return { owner, candidates: explained };
  }
  if (policy.mode === "territory") {
    const territoryMembers = await activeTerritoryUserIds(client, context, policy.territory_id);
    const owner = await leastLoadedLeadOwner(client, context, territoryMembers);
    return {
      owner,
      candidates: territoryMembers.map((userId) => ({ userId, name: null, eligible: userId === owner, reasons: userId === owner ? [] : ["Not least-loaded in territory"] })),
    };
  }
  return { owner: null, candidates: [] };
}

async function assertEligibleLeadAssigneeSoft(client, context, userId, input) {
  try {
    return await assertEligibleLeadAssignee(client, context, userId, {
      companyId: input.companyId || input.company_id || null,
      branchId: input.branchId || input.branch_id || null,
    });
  } catch {
    return null;
  }
}

// Backward-compatible convenience used by the automatic-routing paths that
// don't need the trace (kept for callers migrated before explainability
// existed); resolveLeadAssignment below is the one used by the API surface.
async function ownerForLeadPolicy(client, context, policy, input) {
  return (await ownerForLeadPolicyWithTrace(client, context, policy, input)).owner;
}

export async function resolveLeadAssignment(client, context, input) {
  const result = await client.query(
    `SELECT * FROM tenant.crm_lead_assignment_policies WHERE organization_id=$1 AND status='active' ORDER BY sequence,id FOR UPDATE`,
    [context.organizationId],
  );
  const evaluatedPolicies = [];
  for (const policy of result.rows) {
    const matched = matches(policy.criteria, input);
    evaluatedPolicies.push({ policyId: String(policy.id), mode: policy.mode, matched });
    if (!matched) continue;
    const { owner, candidates } = await ownerForLeadPolicyWithTrace(client, context, policy, input);
    if (owner)
      return {
        ownerUserId: String(owner),
        policyId: String(policy.id),
        reason: `policy:${policy.mode}`,
        trace: { evaluatedPolicies, candidates, fallbackUsed: false },
      };
  }
  // F005: every active policy either didn't match or couldn't produce an
  // available owner. Before giving up, try the one configured fallback
  // owner — this is deliberately checked last and only once, never a
  // substitute for a real policy, and it re-validates eligibility (an
  // org can change roles/scope after configuring a fallback owner).
  const fallback = await client.query(
    `SELECT fallback_user_id FROM tenant.crm_lead_assignment_fallback WHERE organization_id=$1`,
    [context.organizationId],
  );
  const fallbackUserId = fallback.rows[0]?.fallback_user_id;
  if (fallbackUserId) {
    const assignee = await getEligibleLeadAssigneeSoft(client, context, fallbackUserId, input);
    if (assignee)
      return {
        ownerUserId: String(assignee.id),
        policyId: null,
        reason: "fallback_queue",
        trace: { evaluatedPolicies, candidates: [], fallbackUsed: true },
      };
  }
  return { ownerUserId: null, policyId: null, reason: "unassigned", trace: { evaluatedPolicies, candidates: [], fallbackUsed: Boolean(fallbackUserId) } };
}

async function getEligibleLeadAssigneeSoft(client, context, userId, input) {
  return getEligibleLeadAssignee(client, context, userId, {
    companyId: input.companyId || input.company_id || null,
    branchId: input.branchId || input.branch_id || null,
  });
}

export async function resolveLeadOwner(client, context, input) {
  return (await resolveLeadAssignment(client, context, input)).ownerUserId;
}

export async function listLeadAssignmentPolicies(client, context) {
  const result = await client.query(
    `SELECT policy.*,assignee.full_name AS assignee_name,assignee.email AS assignee_email,assignee.status AS assignee_status,
            territory.name AS territory_name,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object('id',member.id,'name',member.full_name,'email',member.email) ORDER BY configured.position)
                FROM unnest(policy.member_user_ids) WITH ORDINALITY configured(user_id,position)
                JOIN public.users member ON member.id=configured.user_id
            ),'[]'::jsonb) AS members
       FROM tenant.crm_lead_assignment_policies policy
       LEFT JOIN public.users assignee ON assignee.id=policy.assignee_user_id
       LEFT JOIN tenant.crm_territories territory ON territory.organization_id=policy.organization_id AND territory.id=policy.territory_id
      WHERE policy.organization_id=$1 ORDER BY policy.sequence,policy.id`,
    [context.organizationId],
  );
  return result.rows;
}

export async function saveLeadAssignmentPolicy(client, context, input = {}) {
  const id = text(input.id);
  const name = text(input.name).slice(0, 160);
  const mode = text(input.mode);
  const sequence = Number.isFinite(Number(input.sequence)) ? Math.trunc(Number(input.sequence)) : 100;
  const criteria = normalizeLeadAssignmentCriteria(input.criteria || {});
  const assigneeUserId = text(input.assigneeUserId) || null;
  const memberUserIds = Array.isArray(input.memberUserIds) ? [...new Set(input.memberUserIds.map(text).filter(Boolean))] : [];
  const territoryId = text(input.territoryId) || null;
  const status = text(input.status || "active");
  if (!name) throw new LeadGovernanceError(400, "Assignment-rule name is required.", "CRM_ASSIGNMENT_RULE_INVALID");
  if (sequence < 0 || sequence > 100000)
    throw new LeadGovernanceError(400, "Assignment-rule priority must be between 0 and 100000.", "CRM_ASSIGNMENT_RULE_INVALID");
  if (!ASSIGNMENT_MODES.has(mode))
    throw new LeadGovernanceError(400, "Unsupported lead-assignment mode.", "CRM_ASSIGNMENT_RULE_INVALID");
  if (mode === "fixed" && !assigneeUserId)
    throw new LeadGovernanceError(400, "Fixed assignment requires an assignee.", "CRM_ASSIGNMENT_RULE_INVALID");
  if ((mode === "round_robin" || mode === "workload") && !memberUserIds.length)
    throw new LeadGovernanceError(400, `${mode === "round_robin" ? "Round-robin" : "Workload-based"} assignment requires at least one member.`, "CRM_ASSIGNMENT_RULE_INVALID");
  if (mode === "territory" && !territoryId)
    throw new LeadGovernanceError(400, "Territory-based assignment requires a territory.", "CRM_ASSIGNMENT_RULE_INVALID");
  if (!["active", "inactive"].includes(status))
    throw new LeadGovernanceError(400, "Assignment-rule status is invalid.", "CRM_ASSIGNMENT_RULE_INVALID");
  // Stage A2 §14 concurrency audit: this is the REAL, actively-used
  // assignment-policy table (see the module comment above) — it had no
  // optimistic-concurrency check at all on update, unlike every other
  // governed CRM configuration resource fixed in this pass. Two admins
  // editing the same policy (e.g. one changing round-robin members while
  // another changes its criteria) could silently overwrite each other.
  // Checked here, before any further validation queries, so a stale/missing
  // version is rejected as cheaply as the other input-shape checks above.
  let before = null;
  if (id) {
    const existing = await client.query(
      `SELECT updated_at FROM tenant.crm_lead_assignment_policies WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, id],
    );
    if (!existing.rows[0]) throw new LeadGovernanceError(404, "Assignment rule not found.", "CRM_ASSIGNMENT_RULE_NOT_FOUND");
    before = existing.rows[0];
    const expectedUpdatedAt = text(input.expectedUpdatedAt);
    if (!expectedUpdatedAt)
      throw new LeadGovernanceError(400, "Refresh this Assignment rule before changing it.", "CRM_ASSIGNMENT_RULE_VERSION_REQUIRED");
    if (Number.isNaN(Date.parse(expectedUpdatedAt)))
      throw new LeadGovernanceError(400, "The Assignment rule version is invalid. Refresh and try again.", "CRM_ASSIGNMENT_RULE_VERSION_INVALID");
  }
  if (criteria.sourceId) {
    const source = await client.query(
      `SELECT id FROM tenant.crm_lead_sources WHERE organization_id=$1 AND id=$2 AND status='active'`,
      [context.organizationId, criteria.sourceId],
    );
    if (!source.rows[0]) throw new LeadGovernanceError(409, "Select an active Lead Source for this rule.", "CRM_ASSIGNMENT_RULE_INVALID");
  }
  if (mode === "territory") {
    const territory = await client.query(
      `SELECT id FROM tenant.crm_territories WHERE organization_id=$1 AND id=$2 AND status='active'`,
      [context.organizationId, territoryId],
    );
    if (!territory.rows[0]) throw new LeadGovernanceError(409, "Select an active territory for this rule.", "CRM_ASSIGNMENT_RULE_INVALID");
  }
  for (const userId of mode === "fixed" ? [assigneeUserId] : mode === "territory" ? [] : memberUserIds)
    await assertEligibleLeadAssignee(client, context, userId);
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || lower($2),0))`, [context.organizationId, name]);
  const duplicate = await client.query(
    `SELECT id FROM tenant.crm_lead_assignment_policies WHERE organization_id=$1 AND lower(name)=lower($2) AND ($3::uuid IS NULL OR id<>$3) LIMIT 1`,
    [context.organizationId, name, id || null],
  );
  if (duplicate.rows[0]) throw new LeadGovernanceError(409, "An assignment rule with this name already exists.", "CRM_ASSIGNMENT_RULE_DUPLICATE");
  const values = [
    context.organizationId,
    context.userId,
    name,
    sequence,
    JSON.stringify(criteria),
    mode,
    mode === "fixed" ? assigneeUserId : null,
    mode === "round_robin" || mode === "workload" ? memberUserIds : [],
    mode === "territory" ? territoryId : null,
    status,
  ];
  const result = id
    ? await client.query(
        // Same millisecond-truncation-safe comparison used by the generic
        // updateCrmRecord versionGuard: `before.updated_at` (and any
        // client-supplied expectedUpdatedAt) can only ever carry millisecond
        // precision, while the stored column is full-microsecond timestamptz.
        `UPDATE tenant.crm_lead_assignment_policies SET name=$3,sequence=$4,criteria=$5::jsonb,mode=$6,
         assignee_user_id=$7,member_user_ids=$8::uuid[],territory_id=$9,status=$10,updated_by=$2,updated_at=now()
         WHERE organization_id=$1 AND id=$11
           AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $12::timestamptz)
         RETURNING *`,
        [...values, id, input.expectedUpdatedAt],
      )
    : await client.query(
        `INSERT INTO tenant.crm_lead_assignment_policies(organization_id,name,sequence,criteria,mode,assignee_user_id,member_user_ids,territory_id,status,created_by,updated_by)
         VALUES($1,$3,$4,$5::jsonb,$6,$7,$8::uuid[],$9,$10,$2,$2) RETURNING *`,
        values,
      );
  if (!result.rows[0]) {
    if (before)
      throw new LeadGovernanceError(409, "This Assignment rule changed after you loaded it. Refresh and try again.", "CRM_STALE_WRITE");
    throw new LeadGovernanceError(404, "Assignment rule not found.", "CRM_ASSIGNMENT_RULE_NOT_FOUND");
  }
  return result.rows[0];
}

export async function setLeadAssignmentPolicyStatus(client, context, policyId, status, expectedUpdatedAt) {
  if (!UUID.test(String(policyId || "")) || !["active", "inactive"].includes(status))
    throw new LeadGovernanceError(400, "Assignment-rule status request is invalid.", "CRM_ASSIGNMENT_RULE_INVALID");
  const policy = await client.query(
    `SELECT * FROM tenant.crm_lead_assignment_policies WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, policyId],
  );
  if (!policy.rows[0]) throw new LeadGovernanceError(404, "Assignment rule not found.", "CRM_ASSIGNMENT_RULE_NOT_FOUND");
  if (!ASSIGNMENT_MODES.has(String(policy.rows[0].mode)))
    throw new LeadGovernanceError(409, "This assignment mode is outside F005 configuration.", "CRM_ASSIGNMENT_RULE_INVALID");
  if (status === "active") {
    const row = policy.rows[0];
    for (const userId of row.mode === "fixed" ? [row.assignee_user_id] : row.mode === "territory" ? [] : row.member_user_ids || [])
      await assertEligibleLeadAssignee(client, context, userId);
  }
  // Stage A2 §14: same checked-write contract as saveLeadAssignmentPolicy
  // above — an activate/deactivate/archive toggle is still a mutation two
  // admins could race on.
  const expected = text(expectedUpdatedAt);
  if (!expected)
    throw new LeadGovernanceError(400, "Refresh this Assignment rule before changing it.", "CRM_ASSIGNMENT_RULE_VERSION_REQUIRED");
  if (Number.isNaN(Date.parse(expected)))
    throw new LeadGovernanceError(400, "The Assignment rule version is invalid. Refresh and try again.", "CRM_ASSIGNMENT_RULE_VERSION_INVALID");
  const result = await client.query(
    `UPDATE tenant.crm_lead_assignment_policies SET status=$3,updated_by=$2,updated_at=now()
     WHERE organization_id=$1 AND id=$4
       AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $5::timestamptz)
     RETURNING *`,
    [context.organizationId, context.userId, status, policyId, expected],
  );
  if (!result.rows[0])
    throw new LeadGovernanceError(409, "This Assignment rule changed after you loaded it. Refresh and try again.", "CRM_STALE_WRITE");
  return result.rows[0];
}

export async function archiveLeadAssignmentPolicy(client, context, policyId, expectedUpdatedAt) {
  return setLeadAssignmentPolicyStatus(client, context, policyId, "inactive", expectedUpdatedAt);
}
