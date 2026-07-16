import { CRM_RESOURCE_KEYS } from "@vercent/shared-types";

const resourceSet = new Set(CRM_RESOURCE_KEYS);

export class CrmError extends Error {
  constructor(status, message, code = "CRM_ERROR") {
    super(message);
    this.name = "CrmError";
    this.status = status;
    this.code = code;
  }
}

const resources = Object.freeze({
  leads: {
    table: "tenant.crm_leads",
    codeEntity: "crm_lead",
    codeField: "code",
    search: [
      "code",
      "first_name",
      "last_name",
      "email",
      "phone",
      "mobile",
      "company_name",
      "product_interest",
    ],
    orderBy: "updated_at DESC, created_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      branchId: "branch_id",
      code: "code",
      firstName: "first_name",
      lastName: "last_name",
      email: "email",
      phone: "phone",
      mobile: "mobile",
      companyName: "company_name",
      jobTitle: "job_title",
      website: "website",
      industry: "industry",
      sourceId: "source_id",
      campaignId: "campaign_id",
      status: "status",
      priority: "priority",
      rating: "rating",
      ownerUserId: "owner_user_id",
      score: "score",
      estimatedValue: "estimated_value",
      currencyCode: "currency_code",
      city: "city",
      state: "state",
      countryCode: "country_code",
      productInterest: "product_interest",
      nextFollowUpAt: "next_follow_up_at",
      consentEmail: "consent_email",
      consentSms: "consent_sms",
      consentWhatsapp: "consent_whatsapp",
      doNotContact: "do_not_contact",
      unqualifiedReason: "unqualified_reason",
      customData: "custom_data",
    },
  },
  opportunities: {
    table: "tenant.crm_opportunities",
    codeEntity: "crm_opportunity",
    codeField: "code",
    search: ["code", "name", "description", "next_step", "loss_notes"],
    orderBy: "expected_close_date ASC NULLS LAST, updated_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      branchId: "branch_id",
      code: "code",
      pipelineId: "pipeline_id",
      stageId: "stage_id",
      leadId: "lead_id",
      partyId: "party_id",
      contactId: "contact_id",
      campaignId: "campaign_id",
      sourceId: "source_id",
      ownerUserId: "owner_user_id",
      name: "name",
      description: "description",
      amount: "amount",
      currencyCode: "currency_code",
      probability: "probability",
      expectedCloseDate: "expected_close_date",
      actualCloseDate: "actual_close_date",
      status: "status",
      forecastCategory: "forecast_category",
      nextStep: "next_step",
      lostReasonId: "lost_reason_id",
      lossNotes: "loss_notes",
      customData: "custom_data",
    },
  },
  activities: {
    table: "tenant.crm_activities",
    search: ["subject", "description", "outcome", "location"],
    orderBy: "COALESCE(due_at, start_at, created_at) ASC, created_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      branchId: "branch_id",
      entityType: "entity_type",
      entityId: "entity_id",
      activityType: "activity_type",
      subject: "subject",
      description: "description",
      status: "status",
      priority: "priority",
      assignedTo: "assigned_to",
      startAt: "start_at",
      dueAt: "due_at",
      endAt: "end_at",
      reminderAt: "reminder_at",
      outcome: "outcome",
      location: "location",
      recurringRule: "recurring_rule",
    },
  },
  campaigns: {
    table: "tenant.crm_campaigns",
    codeEntity: "crm_campaign",
    codeField: "code",
    search: ["code", "name", "description", "campaign_type"],
    orderBy: "start_date DESC NULLS LAST, created_at DESC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      code: "code",
      name: "name",
      campaignType: "campaign_type",
      status: "status",
      startDate: "start_date",
      endDate: "end_date",
      budget: "budget",
      expectedRevenue: "expected_revenue",
      actualCost: "actual_cost",
      ownerUserId: "owner_user_id",
      description: "description",
    },
  },
  communications: {
    table: "tenant.crm_communications",
    search: [
      "subject",
      "body",
      "from_address",
      "provider",
      "provider_message_id",
    ],
    orderBy: "occurred_at DESC, created_at DESC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      channel: "channel",
      direction: "direction",
      leadId: "lead_id",
      opportunityId: "opportunity_id",
      partyId: "party_id",
      contactId: "contact_id",
      provider: "provider",
      providerMessageId: "provider_message_id",
      subject: "subject",
      body: "body",
      fromAddress: "from_address",
      toAddresses: "to_addresses",
      status: "status",
      occurredAt: "occurred_at",
      metadata: "metadata",
    },
  },
  pipelines: {
    table: "tenant.crm_pipelines",
    search: ["name", "code", "description"],
    orderBy: "is_default DESC, name ASC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      name: "name",
      code: "code",
      description: "description",
      isDefault: "is_default",
      status: "status",
    },
  },
  stages: {
    table: "tenant.crm_pipeline_stages",
    search: ["name", "code", "forecast_category"],
    orderBy: "pipeline_id ASC, sequence ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      pipelineId: "pipeline_id",
      name: "name",
      code: "code",
      sequence: "sequence",
      probability: "probability",
      forecastCategory: "forecast_category",
      isWon: "is_won",
      isLost: "is_lost",
      staleAfterDays: "stale_after_days",
      status: "status",
    },
  },
  sources: {
    table: "tenant.crm_lead_sources",
    search: ["name", "code", "channel"],
    orderBy: "is_default DESC, name ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      name: "name",
      code: "code",
      channel: "channel",
      isDefault: "is_default",
      status: "status",
    },
  },
  "lost-reasons": {
    table: "tenant.crm_lost_reasons",
    search: ["name", "code", "category"],
    orderBy: "category ASC, name ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      name: "name",
      code: "code",
      category: "category",
      status: "status",
    },
  },
  tags: {
    table: "tenant.crm_tags",
    search: ["name", "color"],
    orderBy: "name ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: { name: "name", color: "color", status: "status" },
  },
  "scoring-rules": {
    table: "tenant.crm_scoring_rules",
    search: ["name", "field_name", "operator"],
    orderBy: "sequence ASC, name ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      name: "name",
      sequence: "sequence",
      fieldName: "field_name",
      operator: "operator",
      comparisonValue: "comparison_value",
      points: "points",
      status: "status",
    },
  },
  "assignment-rules": {
    table: "tenant.crm_assignment_rules",
    search: ["name", "assignment_mode"],
    orderBy: "sequence ASC, name ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      name: "name",
      sequence: "sequence",
      criteria: "criteria",
      assignmentMode: "assignment_mode",
      assigneeUserId: "assignee_user_id",
      roundRobinUserIds: "round_robin_user_ids",
      status: "status",
    },
  },
  sequences: {
    table: "tenant.crm_sequences",
    search: ["name", "description"],
    orderBy: "updated_at DESC, name ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      name: "name",
      description: "description",
      ownerUserId: "owner_user_id",
      status: "status",
    },
  },
  "sequence-steps": {
    table: "tenant.crm_sequence_steps",
    search: ["subject_template", "body_template", "action_type"],
    orderBy: "sequence_id ASC, step_order ASC",
    companyScoped: false,
    fields: {
      sequenceId: "sequence_id",
      stepOrder: "step_order",
      delayMinutes: "delay_minutes",
      actionType: "action_type",
      subjectTemplate: "subject_template",
      bodyTemplate: "body_template",
      assignedToOwner: "assigned_to_owner",
    },
  },
  "sequence-enrollments": {
    table: "tenant.crm_sequence_enrollments",
    search: ["status"],
    orderBy: "next_run_at ASC NULLS LAST, enrolled_at DESC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      sequenceId: "sequence_id",
      leadId: "lead_id",
      contactId: "contact_id",
      opportunityId: "opportunity_id",
      currentStep: "current_step",
      nextRunAt: "next_run_at",
      status: "status",
      enrolledBy: "enrolled_by",
    },
  },
  "automation-rules": {
    table: "tenant.crm_automation_rules",
    search: ["name", "event_type"],
    orderBy: "sequence ASC, name ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      name: "name",
      eventType: "event_type",
      sequence: "sequence",
      conditions: "conditions",
      actions: "actions",
      status: "status",
    },
  },
  "capture-forms": {
    table: "tenant.crm_capture_forms",
    search: ["name", "public_key", "success_message"],
    orderBy: "status ASC, name ASC",
    statusColumn: "status",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      branchId: "branch_id",
      name: "name",
      sourceId: "source_id",
      campaignId: "campaign_id",
      ownerUserId: "owner_user_id",
      allowedOrigins: "allowed_origins",
      requiredFields: "required_fields",
      successMessage: "success_message",
      rateLimitPerHour: "rate_limit_per_hour",
      status: "status",
    },
  },
  competitors: {
    table: "tenant.crm_competitors",
    search: ["name", "website", "strengths", "weaknesses"],
    orderBy: "name ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      name: "name",
      website: "website",
      strengths: "strengths",
      weaknesses: "weaknesses",
      status: "status",
    },
  },
  "forecast-targets": {
    table: "tenant.crm_forecast_targets",
    search: ["currency_code"],
    orderBy: "period_start DESC, user_id NULLS FIRST",
    companyScoped: true,
    fields: {
      companyId: "company_id",
      userId: "user_id",
      periodStart: "period_start",
      periodEnd: "period_end",
      currencyCode: "currency_code",
      targetAmount: "target_amount",
    },
  },
  integrations: {
    table: "tenant.crm_integrations",
    search: ["provider", "display_name", "status"],
    orderBy: "provider ASC, display_name ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      provider: "provider",
      displayName: "display_name",
      credentialReference: "credential_reference",
      configuration: "configuration",
      status: "status",
    },
  },
  "webhook-subscriptions": {
    table: "tenant.crm_webhook_subscriptions",
    search: ["name", "endpoint_url"],
    orderBy: "name ASC",
    statusColumn: "status",
    companyScoped: false,
    fields: {
      name: "name",
      endpointUrl: "endpoint_url",
      eventTypes: "event_types",
      secretReference: "secret_reference",
      status: "status",
    },
  },
  "saved-views": {
    table: "tenant.crm_saved_views",
    search: ["name", "resource"],
    orderBy: "resource ASC, is_default DESC, name ASC",
    companyScoped: false,
    fields: {
      userId: "user_id",
      resource: "resource",
      name: "name",
      filters: "filters",
      sort: "sort",
      columns: "columns",
      isDefault: "is_default",
    },
  },
});

function definitionFor(resource) {
  const definition = resources[resource];
  if (!definition) throw new CrmError(404, "Unknown CRM resource.");
  return definition;
}

export function isCrmResource(value) {
  return resourceSet.has(value);
}
function camelize(value) {
  return value.replace(/_([a-z])/g, (_match, character) =>
    character.toUpperCase(),
  );
}
function camelizeRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [camelize(key), value]),
  );
}
function limitValue(value, fallback = 100, maximum = 500) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(maximum, Math.trunc(parsed)))
    : fallback;
}
function addParameter(parameters, value) {
  parameters.push(value);
  return `$${parameters.length}`;
}

function companyScope(definition, context, parameters, alias = "record") {
  if (!definition.companyScoped || context.allowAllCompanies) return "";
  if (!context.activeCompanyId) return " AND false";
  return ` AND (${alias}.company_id IS NULL OR ${alias}.company_id = ${addParameter(parameters, context.activeCompanyId)})`;
}

async function nextCode(client, organizationId, entityType) {
  const result = await client.query(
    `UPDATE public.numbering_series SET next_number = next_number + 1 WHERE organization_id = $1 AND entity_type = $2 RETURNING prefix, next_number - 1 AS number, padding`,
    [organizationId, entityType],
  );
  if (!result.rows[0])
    throw new CrmError(
      409,
      `Numbering series ${entityType} is not configured.`,
    );
  const row = result.rows[0];
  return `${row.prefix}${String(row.number).padStart(Number(row.padding || 5), "0")}`;
}

function buildSearch(definition, search, parameters, alias = "record") {
  const value = String(search || "").trim();
  if (!value || !definition.search?.length) return "";
  const parameter = addParameter(parameters, `%${value}%`);
  return ` AND (${definition.search.map((column) => `COALESCE(${alias}.${column}::text, '') ILIKE ${parameter}`).join(" OR ")})`;
}

function buildFilters(definition, filters, parameters, alias = "record") {
  let sql = "";
  if (filters.status && filters.status !== "all" && definition.statusColumn)
    sql += ` AND ${alias}.${definition.statusColumn} = ${addParameter(parameters, filters.status)}`;
  for (const [key, column] of [
    ["ownerId", "owner_user_id"],
    ["stageId", "stage_id"],
    ["pipelineId", "pipeline_id"],
    ["sourceId", "source_id"],
    ["campaignId", "campaign_id"],
  ]) {
    if (filters[key] && Object.values(definition.fields).includes(column))
      sql += ` AND ${alias}.${column} = ${addParameter(parameters, filters[key])}`;
  }
  if (definition.table === "tenant.crm_activities") {
    const due = filters.due || "all";
    if (due === "today")
      sql +=
        " AND record.due_at >= current_date AND record.due_at < current_date + interval '1 day'";
    if (due === "overdue")
      sql +=
        " AND record.due_at < now() AND record.status NOT IN ('completed', 'cancelled')";
    if (due === "upcoming")
      sql +=
        " AND record.due_at >= now() AND record.status NOT IN ('completed', 'cancelled')";
  }
  return sql;
}

export async function listCrmRecords(client, context, resource, filters = {}) {
  const definition = definitionFor(resource);
  const parameters = [context.organizationId];
  let where = "record.organization_id = $1";
  where += companyScope(definition, context, parameters);
  where += buildSearch(definition, filters.search, parameters);
  where += buildFilters(definition, filters, parameters);
  const limit = limitValue(filters.limit);
  const offset = Math.max(0, Number(filters.offset || 0) || 0);
  const result = await client.query(
    `SELECT record.*, count(*) OVER()::int AS __total FROM ${definition.table} record WHERE ${where} ORDER BY ${definition.orderBy} LIMIT ${addParameter(parameters, limit)} OFFSET ${addParameter(parameters, offset)}`,
    parameters,
  );
  const total = Number(result.rows[0]?.__total || 0);
  return {
    rows: result.rows.map((row) => {
      const { __total: _ignored, ...record } = row;
      return camelizeRow(record);
    }),
    total,
    limit,
    offset,
  };
}

export async function getCrmRecord(client, context, resource, id) {
  const definition = definitionFor(resource);
  const parameters = [context.organizationId, id];
  const result = await client.query(
    `SELECT record.* FROM ${definition.table} record WHERE record.organization_id = $1 AND record.id = $2${companyScope(definition, context, parameters)} LIMIT 1`,
    parameters,
  );
  if (!result.rows[0]) throw new CrmError(404, "CRM record not found.");
  return camelizeRow(result.rows[0]);
}

function mutableEntries(definition, input) {
  return Object.entries(input).filter(
    ([key, value]) => definition.fields[key] && value !== undefined,
  );
}

export async function createCrmRecord(client, context, resource, input) {
  const definition = definitionFor(resource);
  const prepared = { ...input };
  if (definition.codeEntity && !prepared[definition.codeField])
    prepared[definition.codeField] = await nextCode(
      client,
      context.organizationId,
      definition.codeEntity,
    );
  if (
    definition.companyScoped &&
    !prepared.companyId &&
    context.activeCompanyId
  )
    prepared.companyId = context.activeCompanyId;
  if (
    definition.companyScoped &&
    !prepared.branchId &&
    context.activeBranchId &&
    definition.fields.branchId
  )
    prepared.branchId = context.activeBranchId;
  if (resource === "leads" && !prepared.ownerUserId)
    prepared.ownerUserId = await resolveLeadOwner(client, context, prepared);
  if (
    resource === "opportunities" &&
    (!prepared.pipelineId || !prepared.stageId)
  ) {
    const pipeline = await client.query(
      `SELECT p.id, s.id AS stage_id, s.probability, s.forecast_category FROM tenant.crm_pipelines p JOIN tenant.crm_pipeline_stages s ON s.pipeline_id = p.id AND s.status = 'active' WHERE p.organization_id = $1 AND p.status = 'active' ORDER BY p.is_default DESC, s.sequence ASC LIMIT 1`,
      [context.organizationId],
    );
    if (!pipeline.rows[0])
      throw new CrmError(
        409,
        "Configure an active CRM pipeline before creating opportunities.",
      );
    prepared.pipelineId ||= pipeline.rows[0].id;
    prepared.stageId ||= pipeline.rows[0].stage_id;
    prepared.probability ??= pipeline.rows[0].probability;
    prepared.forecastCategory ??= pipeline.rows[0].forecast_category;
  }
  if (resource === "leads")
    prepared.score = await calculateLeadScore(
      client,
      context.organizationId,
      prepared,
    );
  const entries = mutableEntries(definition, prepared);
  if (!entries.length) throw new CrmError(400, "No CRM fields were supplied.");
  const columns = [
    "organization_id",
    ...entries.map(([key]) => definition.fields[key]),
    "created_by",
    "updated_by",
  ];
  const values = [
    context.organizationId,
    ...entries.map(([, value]) => value),
    context.userId,
    context.userId,
  ];
  const result = await client.query(
    `INSERT INTO ${definition.table} (${columns.join(", ")}) VALUES (${values.map((_value, index) => `$${index + 1}`).join(", ")}) RETURNING *`,
    values,
  );
  const created = camelizeRow(result.rows[0]);
  if (resource === "leads") {
    await recordLeadScore(
      client,
      context,
      created.id,
      0,
      Number(created.score || 0),
      "Initial lead scoring",
    );
    await runCrmAutomation(
      client,
      context,
      "lead.created",
      "lead",
      created.id,
      created,
    );
  }
  if (resource === "opportunities") {
    await client.query(
      `INSERT INTO tenant.crm_opportunity_stage_history (organization_id, opportunity_id, to_stage_id, probability, changed_by, note) VALUES ($1, $2, $3, $4, $5, 'Opportunity created')`,
      [
        context.organizationId,
        created.id,
        created.stageId,
        created.probability,
        context.userId,
      ],
    );
    await runCrmAutomation(
      client,
      context,
      "opportunity.created",
      "opportunity",
      created.id,
      created,
    );
  }
  await queueOutboxEvent(
    client,
    context,
    `crm.${resource}.created`,
    resource,
    created.id,
    created,
  );
  return created;
}

export async function updateCrmRecord(client, context, resource, id, input) {
  const definition = definitionFor(resource);
  const before = await getCrmRecord(client, context, resource, id);
  const prepared = { ...input };
  if (resource === "leads")
    prepared.score = await calculateLeadScore(client, context.organizationId, {
      ...before,
      ...prepared,
    });
  const entries = mutableEntries(definition, prepared);
  if (!entries.length) throw new CrmError(400, "No CRM fields were supplied.");
  const parameters = entries.map(([, value]) => value);
  const assignments = entries.map(
    ([key], index) => `${definition.fields[key]} = $${index + 1}`,
  );
  parameters.push(context.userId, context.organizationId, id);
  const result = await client.query(
    `UPDATE ${definition.table} SET ${assignments.join(", ")}, updated_by = $${entries.length + 1}, updated_at = now() WHERE organization_id = $${entries.length + 2} AND id = $${entries.length + 3} RETURNING *`,
    parameters,
  );
  if (!result.rows[0]) throw new CrmError(404, "CRM record not found.");
  const updated = camelizeRow(result.rows[0]);
  if (
    resource === "leads" &&
    Number(before.score || 0) !== Number(updated.score || 0)
  )
    await recordLeadScore(
      client,
      context,
      id,
      Number(before.score || 0),
      Number(updated.score || 0),
      "Lead fields updated",
    );
  await queueOutboxEvent(
    client,
    context,
    `crm.${resource}.updated`,
    resource,
    id,
    { before, after: updated },
  );
  return updated;
}

export async function archiveCrmRecord(client, context, resource, id) {
  const definition = definitionFor(resource);
  if (!definition.statusColumn) {
    const result = await client.query(
      `DELETE FROM ${definition.table} WHERE organization_id = $1 AND id = $2 RETURNING id`,
      [context.organizationId, id],
    );
    if (!result.rows[0]) throw new CrmError(404, "CRM record not found.");
    return { id, deleted: true };
  }
  const status =
    {
      leads: "archived",
      opportunities: "archived",
      activities: "cancelled",
      campaigns: "cancelled",
      sequences: "archived",
      integrations: "disabled",
    }[resource] || "inactive";
  const result = await client.query(
    `UPDATE ${definition.table} SET ${definition.statusColumn} = $1, updated_by = $2, updated_at = now() WHERE organization_id = $3 AND id = $4 RETURNING *`,
    [status, context.userId, context.organizationId, id],
  );
  if (!result.rows[0]) throw new CrmError(404, "CRM record not found.");
  const record = camelizeRow(result.rows[0]);
  await queueOutboxEvent(
    client,
    context,
    `crm.${resource}.archived`,
    resource,
    id,
    record,
  );
  return record;
}

function comparable(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}
function ruleMatches(record, rule) {
  const value = record[camelize(rule.field_name)];
  const expected = rule.comparison_value?.value ?? rule.comparison_value;
  switch (rule.operator) {
    case "equals":
      return comparable(value) === comparable(expected);
    case "not_equals":
      return comparable(value) !== comparable(expected);
    case "contains":
      return String(value || "")
        .toLowerCase()
        .includes(String(expected || "").toLowerCase());
    case "not_empty":
      return (
        value !== null && value !== undefined && String(value).trim() !== ""
      );
    case "empty":
      return (
        value === null || value === undefined || String(value).trim() === ""
      );
    case "greater_than":
      return Number(value) > Number(expected);
    case "less_than":
      return Number(value) < Number(expected);
    case "in":
      return (
        Array.isArray(expected) &&
        expected.map(comparable).includes(comparable(value))
      );
    default:
      return false;
  }
}

export async function calculateLeadScore(client, organizationId, lead) {
  const rules = await client.query(
    `SELECT field_name, operator, comparison_value, points FROM tenant.crm_scoring_rules WHERE organization_id = $1 AND status = 'active' ORDER BY sequence, name`,
    [organizationId],
  );
  return rules.rows.reduce(
    (score, rule) =>
      score + (ruleMatches(lead, rule) ? Number(rule.points || 0) : 0),
    0,
  );
}
async function recordLeadScore(
  client,
  context,
  leadId,
  previousScore,
  newScore,
  reason,
  ruleId = null,
) {
  await client.query(
    `INSERT INTO tenant.crm_lead_score_history (organization_id, lead_id, previous_score, new_score, reason, rule_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      context.organizationId,
      leadId,
      previousScore,
      newScore,
      reason,
      ruleId,
      context.userId,
    ],
  );
}
function criteriaMatches(input, criteria) {
  if (!criteria || typeof criteria !== "object") return true;
  return Object.entries(criteria).every(([key, expected]) =>
    Array.isArray(expected)
      ? expected.map(comparable).includes(comparable(input[key]))
      : comparable(input[key]) === comparable(expected),
  );
}

export async function resolveLeadOwner(client, context, input) {
  const result = await client.query(
    `SELECT * FROM tenant.crm_assignment_rules WHERE organization_id = $1 AND status = 'active' ORDER BY sequence, name`,
    [context.organizationId],
  );
  const rule = result.rows.find((candidate) =>
    criteriaMatches(input, candidate.criteria),
  );
  if (!rule) return context.userId;
  if (rule.assignment_mode === "fixed")
    return rule.assignee_user_id || context.userId;
  const users = rule.round_robin_user_ids || [];
  if (!users.length) return context.userId;
  const state = await client.query(
    `INSERT INTO tenant.crm_round_robin_state (organization_id, assignment_rule_id, next_index) VALUES ($1, $2, 1) ON CONFLICT (organization_id, assignment_rule_id) DO UPDATE SET next_index = tenant.crm_round_robin_state.next_index + 1, updated_at = now() RETURNING next_index`,
    [context.organizationId, rule.id],
  );
  return users[
    Math.max(0, Number(state.rows[0]?.next_index || 1) - 1) % users.length
  ];
}

export async function convertCrmLead(client, context, leadId, input = {}) {
  const existing = await client.query(
    `SELECT * FROM tenant.crm_conversion_records WHERE organization_id = $1 AND lead_id = $2 LIMIT 1`,
    [context.organizationId, leadId],
  );
  if (existing.rows[0])
    return { ...camelizeRow(existing.rows[0]), replayed: true };
  const leadResult = await client.query(
    `SELECT * FROM tenant.crm_leads WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [context.organizationId, leadId],
  );
  const lead = leadResult.rows[0];
  if (!lead) throw new CrmError(404, "Lead not found.");
  if (lead.status === "archived")
    throw new CrmError(409, "Archived leads cannot be converted.");
  let partyId = input.partyId || null;
  if (!partyId) {
    const duplicate = await client.query(
      `SELECT p.id FROM tenant.business_parties p LEFT JOIN tenant.contacts c ON c.party_id = p.id AND c.organization_id = p.organization_id WHERE p.organization_id = $1 AND (lower(p.display_name) = lower($2) OR ($3::text IS NOT NULL AND tenant.crm_normalize_email(c.email) = tenant.crm_normalize_email($3))) ORDER BY p.created_at LIMIT 1`,
      [
        context.organizationId,
        lead.company_name || lead.full_name,
        lead.email || null,
      ],
    );
    partyId = duplicate.rows[0]?.id || null;
  }
  if (!partyId) {
    const partyCode = await nextCode(
      client,
      context.organizationId,
      "business_party",
    );
    const party = await client.query(
      `INSERT INTO tenant.business_parties (organization_id, company_id, code, party_type, display_name, legal_name, currency_code, created_by, updated_by) VALUES ($1, $2, $3, 'customer', $4, $5, $6, $7, $7) RETURNING id`,
      [
        context.organizationId,
        lead.company_id,
        partyCode,
        lead.company_name || lead.full_name,
        lead.company_name || null,
        lead.currency_code || null,
        context.userId,
      ],
    );
    partyId = party.rows[0].id;
  }
  let contactId = input.contactId || null;
  if (!contactId && (lead.email || lead.mobile || lead.phone)) {
    const contact = await client.query(
      `SELECT id FROM tenant.contacts WHERE organization_id = $1 AND party_id = $2 AND (($3::text IS NOT NULL AND tenant.crm_normalize_email(email) = tenant.crm_normalize_email($3)) OR ($4::text IS NOT NULL AND tenant.crm_normalize_phone(COALESCE(mobile, phone)) = tenant.crm_normalize_phone($4))) ORDER BY is_primary DESC, created_at LIMIT 1`,
      [
        context.organizationId,
        partyId,
        lead.email || null,
        lead.mobile || lead.phone || null,
      ],
    );
    contactId = contact.rows[0]?.id || null;
  }
  if (!contactId) {
    const contact = await client.query(
      `INSERT INTO tenant.contacts (organization_id, party_id, first_name, last_name, designation, email, phone, mobile, is_primary, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOT EXISTS (SELECT 1 FROM tenant.contacts WHERE organization_id = $1 AND party_id = $2 AND is_primary = true AND status = 'active'), $9, $9) RETURNING id`,
      [
        context.organizationId,
        partyId,
        lead.first_name,
        lead.last_name,
        lead.job_title,
        lead.email,
        lead.phone,
        lead.mobile,
        context.userId,
      ],
    );
    contactId = contact.rows[0].id;
  }
  let opportunityId = null;
  if (input.createOpportunity !== false) {
    const opportunity = await createCrmRecord(
      client,
      context,
      "opportunities",
      {
        companyId: lead.company_id,
        branchId: lead.branch_id,
        leadId,
        partyId,
        contactId,
        campaignId: lead.campaign_id,
        sourceId: lead.source_id,
        ownerUserId: lead.owner_user_id || context.userId,
        name:
          input.opportunityName ||
          `${lead.company_name || lead.full_name} opportunity`,
        amount: input.amount ?? lead.estimated_value ?? 0,
        currencyCode: input.currencyCode || lead.currency_code,
        expectedCloseDate: input.expectedCloseDate || null,
        nextStep:
          input.nextStep || "Complete discovery and confirm requirements",
      },
    );
    opportunityId = opportunity.id;
  }
  await client.query(
    `UPDATE tenant.crm_leads SET status = 'converted', converted_at = now(), converted_party_id = $1, converted_contact_id = $2, converted_opportunity_id = $3, updated_by = $4, updated_at = now() WHERE organization_id = $5 AND id = $6`,
    [
      partyId,
      contactId,
      opportunityId,
      context.userId,
      context.organizationId,
      leadId,
    ],
  );
  const conversion = await client.query(
    `INSERT INTO tenant.crm_conversion_records (organization_id, lead_id, party_id, contact_id, opportunity_id, converted_by, input_snapshot) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      context.organizationId,
      leadId,
      partyId,
      contactId,
      opportunityId,
      context.userId,
      input,
    ],
  );
  await client.query(
    `UPDATE tenant.crm_campaign_members SET member_status = 'converted', converted_at = now() WHERE organization_id = $1 AND lead_id = $2`,
    [context.organizationId, leadId],
  );
  await queueOutboxEvent(
    client,
    context,
    "crm.lead.converted",
    "lead",
    leadId,
    { partyId, contactId, opportunityId },
  );
  return { ...camelizeRow(conversion.rows[0]), replayed: false };
}

export async function mergeCrmLead(client, context, sourceId, targetId) {
  if (sourceId === targetId)
    throw new CrmError(400, "A lead cannot be merged into itself.");
  const rows = await client.query(
    `SELECT * FROM tenant.crm_leads WHERE organization_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE`,
    [context.organizationId, [sourceId, targetId]],
  );
  const source = rows.rows.find((row) => row.id === sourceId);
  const target = rows.rows.find((row) => row.id === targetId);
  if (!source || !target)
    throw new CrmError(404, "Source or target lead was not found.");
  if (source.status === "converted")
    throw new CrmError(409, "Converted leads cannot be merged.");
  await client.query(
    `INSERT INTO tenant.crm_lead_tags (organization_id, lead_id, tag_id, created_by) SELECT organization_id, $3, tag_id, $4 FROM tenant.crm_lead_tags WHERE organization_id = $1 AND lead_id = $2 ON CONFLICT DO NOTHING`,
    [context.organizationId, sourceId, targetId, context.userId],
  );
  await client.query(
    `UPDATE tenant.crm_activities SET entity_id = $1, updated_by = $2, updated_at = now() WHERE organization_id = $3 AND entity_type = 'lead' AND entity_id = $4`,
    [targetId, context.userId, context.organizationId, sourceId],
  );
  await client.query(
    `UPDATE tenant.crm_communications SET lead_id = $1 WHERE organization_id = $2 AND lead_id = $3`,
    [targetId, context.organizationId, sourceId],
  );
  await client.query(
    `INSERT INTO tenant.crm_campaign_members (organization_id, campaign_id, lead_id, member_status, responded_at, converted_at, created_by) SELECT organization_id, campaign_id, $1, member_status, responded_at, converted_at, $2 FROM tenant.crm_campaign_members WHERE organization_id = $3 AND lead_id = $4 ON CONFLICT DO NOTHING`,
    [targetId, context.userId, context.organizationId, sourceId],
  );
  await client.query(
    `DELETE FROM tenant.crm_campaign_members WHERE organization_id = $1 AND lead_id = $2`,
    [context.organizationId, sourceId],
  );
  await client.query(
    `UPDATE tenant.crm_leads SET status = 'archived', unqualified_reason = $1, updated_by = $2, updated_at = now() WHERE organization_id = $3 AND id = $4`,
    [
      `Merged into ${targetId}`,
      context.userId,
      context.organizationId,
      sourceId,
    ],
  );
  const result = await client.query(
    `INSERT INTO tenant.crm_merge_records (organization_id, entity_type, source_id, target_id, merged_by, snapshot) VALUES ($1, 'lead', $2, $3, $4, $5) RETURNING *`,
    [
      context.organizationId,
      sourceId,
      targetId,
      context.userId,
      { source, target },
    ],
  );
  await queueOutboxEvent(client, context, "crm.lead.merged", "lead", targetId, {
    sourceId,
    targetId,
  });
  return camelizeRow(result.rows[0]);
}

export async function moveOpportunityStage(
  client,
  context,
  opportunityId,
  stageId,
  note = null,
) {
  const opportunityResult = await client.query(
    `SELECT * FROM tenant.crm_opportunities WHERE organization_id = $1 AND id = $2 FOR UPDATE`,
    [context.organizationId, opportunityId],
  );
  const opportunity = opportunityResult.rows[0];
  if (!opportunity) throw new CrmError(404, "Opportunity not found.");
  const stageResult = await client.query(
    `SELECT * FROM tenant.crm_pipeline_stages WHERE organization_id = $1 AND id = $2 AND pipeline_id = $3 AND status = 'active'`,
    [context.organizationId, stageId, opportunity.pipeline_id],
  );
  const stage = stageResult.rows[0];
  if (!stage)
    throw new CrmError(
      409,
      "The selected stage is not part of this opportunity pipeline.",
    );
  const status = stage.is_won ? "won" : stage.is_lost ? "lost" : "open";
  const result = await client.query(
    `UPDATE tenant.crm_opportunities SET stage_id = $1, probability = $2, forecast_category = $3, status = $4, actual_close_date = CASE WHEN $4 IN ('won','lost') THEN current_date ELSE NULL END, updated_by = $5, updated_at = now() WHERE organization_id = $6 AND id = $7 RETURNING *`,
    [
      stageId,
      stage.probability,
      stage.forecast_category,
      status,
      context.userId,
      context.organizationId,
      opportunityId,
    ],
  );
  await client.query(
    `INSERT INTO tenant.crm_opportunity_stage_history (organization_id, opportunity_id, from_stage_id, to_stage_id, probability, changed_by, note) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      context.organizationId,
      opportunityId,
      opportunity.stage_id,
      stageId,
      stage.probability,
      context.userId,
      note,
    ],
  );
  const updated = camelizeRow(result.rows[0]);
  await runCrmAutomation(
    client,
    context,
    "opportunity.stage_changed",
    "opportunity",
    opportunityId,
    updated,
  );
  await queueOutboxEvent(
    client,
    context,
    "crm.opportunity.stage_changed",
    "opportunity",
    opportunityId,
    { fromStageId: opportunity.stage_id, toStageId: stageId, status },
  );
  return updated;
}

export async function completeCrmActivity(
  client,
  context,
  activityId,
  outcome = null,
) {
  const result = await client.query(
    `UPDATE tenant.crm_activities SET status = 'completed', completed_at = now(), outcome = COALESCE($1, outcome), updated_by = $2, updated_at = now() WHERE organization_id = $3 AND id = $4 RETURNING *`,
    [outcome, context.userId, context.organizationId, activityId],
  );
  if (!result.rows[0]) throw new CrmError(404, "Activity not found.");
  const activity = camelizeRow(result.rows[0]);
  if (activity.entityType === "lead" && activity.entityId)
    await client.query(
      `UPDATE tenant.crm_leads SET last_contacted_at = now(), first_responded_at = COALESCE(first_responded_at, now()), updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, activity.entityId],
    );
  if (activity.entityType === "opportunity" && activity.entityId)
    await client.query(
      `UPDATE tenant.crm_opportunities SET last_activity_at = now(), updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, activity.entityId],
    );
  await queueOutboxEvent(
    client,
    context,
    "crm.activity.completed",
    "activity",
    activityId,
    activity,
  );
  return activity;
}

export async function runCrmAutomation(
  client,
  context,
  eventType,
  entityType,
  entityId,
  payload,
) {
  const rules = await client.query(
    `SELECT * FROM tenant.crm_automation_rules WHERE organization_id = $1 AND event_type = $2 AND status = 'active' ORDER BY sequence, name`,
    [context.organizationId, eventType],
  );
  const results = [];
  for (const rule of rules.rows) {
    if (!criteriaMatches(payload, rule.conditions)) {
      results.push({ ruleId: rule.id, status: "skipped" });
      continue;
    }
    const output = [];
    try {
      for (const action of Array.isArray(rule.actions) ? rule.actions : []) {
        if (action.type === "create_activity") {
          const created = await createCrmRecord(client, context, "activities", {
            entityType,
            entityId,
            activityType: action.activityType || "task",
            subject:
              action.subject ||
              `Follow up: ${payload.name || payload.fullName || entityType}`,
            description: action.description || null,
            assignedTo:
              action.assignedTo || payload.ownerUserId || context.userId,
            dueAt: new Date(
              Date.now() + Number(action.delayMinutes || 0) * 60000,
            ).toISOString(),
          });
          output.push({ action: action.type, id: created.id });
        }
        if (action.type === "notification" && action.userId) {
          await client.query(
            `INSERT INTO public.notifications (organization_id, user_id, type, title, message, href) VALUES ($1, $2, 'crm_automation', $3, $4, $5)`,
            [
              context.organizationId,
              action.userId,
              action.title || "CRM automation",
              action.message || "A CRM automation rule ran.",
              action.href || `/crm/${entityType}s/${entityId}`,
            ],
          );
          output.push({ action: action.type });
        }
      }
      await client.query(
        `INSERT INTO tenant.crm_automation_runs (organization_id, rule_id, event_type, entity_type, entity_id, status, result, finished_at) VALUES ($1, $2, $3, $4, $5, 'succeeded', $6, now())`,
        [
          context.organizationId,
          rule.id,
          eventType,
          entityType,
          entityId,
          output,
        ],
      );
      results.push({ ruleId: rule.id, status: "succeeded", output });
    } catch (error) {
      await client.query(
        `INSERT INTO tenant.crm_automation_runs (organization_id, rule_id, event_type, entity_type, entity_id, status, error_message, finished_at) VALUES ($1, $2, $3, $4, $5, 'failed', $6, now())`,
        [
          context.organizationId,
          rule.id,
          eventType,
          entityType,
          entityId,
          String(error?.message || error),
        ],
      );
      results.push({ ruleId: rule.id, status: "failed" });
    }
  }
  return results;
}

export async function queueOutboxEvent(
  client,
  context,
  eventType,
  entityType,
  entityId,
  payload,
) {
  await client.query(
    `INSERT INTO tenant.crm_outbox_events (organization_id, event_type, entity_type, entity_id, payload) VALUES ($1, $2, $3, $4, $5)`,
    [context.organizationId, eventType, entityType, entityId, payload || {}],
  );
}

export async function getCrmOptions(client, context) {
  const [
    companies,
    branches,
    currencies,
    pipelines,
    stages,
    sources,
    campaigns,
    users,
    parties,
    contacts,
    items,
    priceLists,
    tags,
    lostReasons,
    leads,
    opportunities,
    sequences,
  ] = [
    await client.query(
      `SELECT id, name FROM public.companies WHERE organization_id = $1 AND status = 'active' ORDER BY is_primary DESC, name`,
      [context.organizationId],
    ),
    await client.query(
      `SELECT id, name, company_id FROM public.branches WHERE organization_id = $1 AND status = 'active' ORDER BY is_primary DESC, name`,
      [context.organizationId],
    ),
    await client.query(
      `SELECT code AS id, code AS name FROM tenant.currencies WHERE organization_id = $1 AND status = 'active' ORDER BY is_base DESC, code`,
      [context.organizationId],
    ),
    await client.query(
      `SELECT id, name, company_id FROM tenant.crm_pipelines WHERE organization_id = $1 AND status = 'active' ORDER BY is_default DESC, name`,
      [context.organizationId],
    ),
    await client.query(
      `SELECT id, pipeline_id, name, sequence, probability, is_won, is_lost FROM tenant.crm_pipeline_stages WHERE organization_id = $1 AND status = 'active' ORDER BY pipeline_id, sequence`,
      [context.organizationId],
    ),
    await client.query(
      `SELECT id, name FROM tenant.crm_lead_sources WHERE organization_id = $1 AND status = 'active' ORDER BY is_default DESC, name`,
      [context.organizationId],
    ),
    await client.query(
      `SELECT id, name FROM tenant.crm_campaigns WHERE organization_id = $1 AND status IN ('planned','active','paused') ORDER BY name`,
      [context.organizationId],
    ),
    await client.query(
      `SELECT u.id, u.full_name AS name FROM public.organization_memberships m JOIN public.users u ON u.id = m.user_id WHERE m.organization_id = $1 AND m.status = 'active' ORDER BY u.full_name`,
      [context.organizationId],
    ),
    await client.query(
      `SELECT id, display_name AS name FROM tenant.business_parties WHERE organization_id = $1 AND status = 'active' ORDER BY display_name`,
      [context.organizationId],
    ),
    await client.query(
      `SELECT id, btrim(first_name || ' ' || COALESCE(last_name,'')) AS name, party_id FROM tenant.contacts WHERE organization_id = $1 AND status = 'active' ORDER BY first_name, last_name`,
      [context.organizationId],
    ),
    await client.query(
      `SELECT id, name, sales_price FROM tenant.items WHERE organization_id = $1 AND status = 'active' ORDER BY name`,
      [context.organizationId],
    ),
    await client.query(
      `SELECT id, name, currency_code FROM tenant.price_lists WHERE organization_id = $1 AND status = 'active' ORDER BY name`,
      [context.organizationId],
    ),
    await client.query(
      `SELECT id, name, color FROM tenant.crm_tags WHERE organization_id = $1 AND status = 'active' ORDER BY name`,
      [context.organizationId],
    ),
    await client.query(
      `SELECT id, name FROM tenant.crm_lost_reasons WHERE organization_id = $1 AND status = 'active' ORDER BY category, name`,
      [context.organizationId],
    ),
    await client.query(
      `SELECT id, btrim(first_name || ' ' || COALESCE(last_name,'')) AS name FROM tenant.crm_leads WHERE organization_id = $1 AND status NOT IN ('converted','archived') ORDER BY updated_at DESC LIMIT 500`,
      [context.organizationId],
    ),
    await client.query(
      `SELECT id, name FROM tenant.crm_opportunities WHERE organization_id = $1 AND status <> 'archived' ORDER BY updated_at DESC LIMIT 500`,
      [context.organizationId],
    ),
    await client.query(
      `SELECT id, name FROM tenant.crm_sequences WHERE organization_id = $1 AND status <> 'archived' ORDER BY name`,
      [context.organizationId],
    ),
  ];
  const map = (result) => result.rows.map(camelizeRow);
  return {
    companies: map(companies),
    branches: map(branches),
    currencies: map(currencies),
    pipelines: map(pipelines),
    stages: map(stages),
    sources: map(sources),
    campaigns: map(campaigns),
    users: map(users),
    parties: map(parties),
    contacts: map(contacts),
    items: map(items),
    priceLists: map(priceLists),
    tags: map(tags),
    lostReasons: map(lostReasons),
    leads: map(leads),
    opportunities: map(opportunities),
    sequences: map(sequences),
  };
}

export async function getCrmDashboard(client, context) {
  const result = await client.query(
    `SELECT (SELECT count(*)::int FROM tenant.crm_leads WHERE organization_id = $1 AND status NOT IN ('converted','archived')) AS open_leads, (SELECT count(*)::int FROM tenant.crm_leads WHERE organization_id = $1 AND status = 'qualified') AS qualified_leads, (SELECT count(*)::int FROM tenant.crm_opportunities WHERE organization_id = $1 AND status = 'open') AS open_opportunities, (SELECT COALESCE(sum(amount),0)::numeric FROM tenant.crm_opportunities WHERE organization_id = $1 AND status = 'open') AS pipeline_value, (SELECT COALESCE(sum(amount * probability / 100),0)::numeric FROM tenant.crm_opportunities WHERE organization_id = $1 AND status = 'open') AS weighted_pipeline, (SELECT count(*)::int FROM tenant.crm_activities WHERE organization_id = $1 AND status NOT IN ('completed','cancelled') AND due_at < now()) AS overdue_activities, (SELECT count(*)::int FROM tenant.crm_activities WHERE organization_id = $1 AND status NOT IN ('completed','cancelled') AND due_at >= current_date AND due_at < current_date + interval '1 day') AS due_today, (SELECT count(*)::int FROM tenant.crm_leads WHERE organization_id = $1 AND created_at >= date_trunc('month', now())) AS leads_this_month, (SELECT count(*)::int FROM tenant.crm_conversion_records WHERE organization_id = $1 AND converted_at >= date_trunc('month', now())) AS conversions_this_month`,
    [context.organizationId],
  );
  const [stages, sources, activities] = [
    await client.query(
      `SELECT s.id, s.name, s.sequence, count(o.id)::int AS opportunity_count, COALESCE(sum(o.amount),0)::numeric AS amount FROM tenant.crm_pipeline_stages s LEFT JOIN tenant.crm_opportunities o ON o.stage_id = s.id AND o.organization_id = s.organization_id AND o.status = 'open' WHERE s.organization_id = $1 AND s.status = 'active' GROUP BY s.id ORDER BY s.sequence`,
      [context.organizationId],
    ),
    await client.query(
      `SELECT COALESCE(src.name,'Unspecified') AS name, count(l.id)::int AS lead_count, count(l.id) FILTER (WHERE l.status = 'converted')::int AS converted_count FROM tenant.crm_leads l LEFT JOIN tenant.crm_lead_sources src ON src.id = l.source_id WHERE l.organization_id = $1 GROUP BY src.name ORDER BY lead_count DESC LIMIT 10`,
      [context.organizationId],
    ),
    await client.query(
      `SELECT a.*, u.full_name AS assigned_name FROM tenant.crm_activities a LEFT JOIN public.users u ON u.id = a.assigned_to WHERE a.organization_id = $1 AND a.status NOT IN ('completed','cancelled') ORDER BY a.due_at ASC NULLS LAST LIMIT 10`,
      [context.organizationId],
    ),
  ];
  return {
    metrics: camelizeRow(result.rows[0]),
    stages: stages.rows.map(camelizeRow),
    sources: sources.rows.map(camelizeRow),
    activities: activities.rows.map(camelizeRow),
  };
}

export async function getCrmReport(client, context, report, filters = {}) {
  const from = filters.from || null,
    to = filters.to || null,
    parameters = [context.organizationId, from, to];
  const dateClause = (column) =>
    `AND ($2::date IS NULL OR ${column} >= $2::date) AND ($3::date IS NULL OR ${column} < $3::date + 1)`;
  let sql;
  if (report === "pipeline")
    sql = `SELECT s.name, s.sequence, count(o.id)::int AS count, COALESCE(sum(o.amount),0)::numeric AS amount, COALESCE(sum(o.amount * o.probability / 100),0)::numeric AS weighted_amount FROM tenant.crm_pipeline_stages s LEFT JOIN tenant.crm_opportunities o ON o.stage_id=s.id AND o.organization_id=s.organization_id ${dateClause("o.created_at")} WHERE s.organization_id=$1 GROUP BY s.id ORDER BY s.sequence`;
  else if (report === "conversion")
    sql = `SELECT date_trunc('month', l.created_at)::date AS period, count(*)::int AS leads, count(*) FILTER (WHERE l.status='converted')::int AS converted, round((count(*) FILTER (WHERE l.status='converted')::numeric / NULLIF(count(*),0))*100,2) AS conversion_rate FROM tenant.crm_leads l WHERE l.organization_id=$1 ${dateClause("l.created_at")} GROUP BY period ORDER BY period`;
  else if (report === "sources")
    sql = `SELECT COALESCE(s.name,'Unspecified') AS source, count(l.id)::int AS leads, count(l.id) FILTER (WHERE l.status='converted')::int AS converted, COALESCE(sum(o.amount) FILTER (WHERE o.status='won'),0)::numeric AS won_revenue FROM tenant.crm_leads l LEFT JOIN tenant.crm_lead_sources s ON s.id=l.source_id LEFT JOIN tenant.crm_opportunities o ON o.lead_id=l.id WHERE l.organization_id=$1 ${dateClause("l.created_at")} GROUP BY s.name ORDER BY leads DESC`;
  else if (report === "activities")
    sql = `SELECT a.activity_type, count(*)::int AS total, count(*) FILTER (WHERE a.status='completed')::int AS completed, count(*) FILTER (WHERE a.due_at<now() AND a.status NOT IN ('completed','cancelled'))::int AS overdue FROM tenant.crm_activities a WHERE a.organization_id=$1 ${dateClause("a.created_at")} GROUP BY a.activity_type ORDER BY total DESC`;
  else if (report === "forecast")
    sql = `SELECT COALESCE(u.full_name,'Unassigned') AS owner, COALESCE(sum(o.amount),0)::numeric AS pipeline, COALESCE(sum(o.amount*o.probability/100),0)::numeric AS weighted, COALESCE(sum(o.amount) FILTER (WHERE o.status='won'),0)::numeric AS won FROM tenant.crm_opportunities o LEFT JOIN public.users u ON u.id=o.owner_user_id WHERE o.organization_id=$1 ${dateClause("o.created_at")} GROUP BY u.full_name ORDER BY weighted DESC`;
  else if (report === "campaigns")
    sql = `SELECT c.name, c.status, c.budget, c.actual_cost, count(m.id)::int AS members, count(m.id) FILTER (WHERE m.member_status IN ('responded','attended','converted'))::int AS responses, count(m.id) FILTER (WHERE m.member_status='converted')::int AS conversions FROM tenant.crm_campaigns c LEFT JOIN tenant.crm_campaign_members m ON m.campaign_id=c.id AND m.organization_id=c.organization_id WHERE c.organization_id=$1 ${dateClause("c.created_at")} GROUP BY c.id ORDER BY c.created_at DESC`;
  else throw new CrmError(404, "Unknown CRM report.");
  const result = await client.query(sql, parameters);
  return { report, rows: result.rows.map(camelizeRow), filters: { from, to } };
}

export async function findCrmDuplicates(
  client,
  context,
  input,
  excludeId = null,
) {
  const result = await client.query(
    `SELECT id, code, full_name, email, mobile, company_name, status, (CASE WHEN $2::text IS NOT NULL AND normalized_email = tenant.crm_normalize_email($2) THEN 2 ELSE 0 END + CASE WHEN $3::text IS NOT NULL AND normalized_phone = tenant.crm_normalize_phone($3) THEN 2 ELSE 0 END + CASE WHEN $4::text IS NOT NULL AND lower(company_name) = lower($4) THEN 1 ELSE 0 END) AS match_score FROM tenant.crm_leads WHERE organization_id = $1 AND ($5::uuid IS NULL OR id <> $5) AND (($2::text IS NOT NULL AND normalized_email = tenant.crm_normalize_email($2)) OR ($3::text IS NOT NULL AND normalized_phone = tenant.crm_normalize_phone($3)) OR ($4::text IS NOT NULL AND lower(company_name) = lower($4))) ORDER BY match_score DESC, updated_at DESC LIMIT 20`,
    [
      context.organizationId,
      input.email || null,
      input.mobile || input.phone || null,
      input.companyName || null,
      excludeId,
    ],
  );
  return result.rows.map(camelizeRow);
}

export async function captureCrmLead(
  client,
  formKey,
  input,
  requestContext = {},
) {
  const formResult = await client.query(
    `SELECT * FROM tenant.crm_public_capture_form($1)`,
    [formKey],
  );
  const form = formResult.rows[0];
  if (!form) throw new CrmError(404, "Lead-capture form not found.");
  await client.query(
    "SELECT set_config('app.current_organization_id', $1, true)",
    [form.organization_id],
  );
  const origin = String(requestContext.origin || "");
  if (form.allowed_origins?.length && !form.allowed_origins.includes(origin))
    throw new CrmError(403, "This origin is not allowed to submit the form.");
  if (input.websiteUrl || input.companyWebsiteHidden)
    throw new CrmError(400, "Submission rejected.");
  const fingerprint = String(requestContext.fingerprint || "unknown"),
    window = new Date();
  window.setMinutes(0, 0, 0);
  const rate = await client.query(
    `INSERT INTO tenant.crm_capture_rate_limits (organization_id, form_id, fingerprint, window_started_at, attempts) VALUES ($1,$2,$3,$4,1) ON CONFLICT (organization_id, form_id, fingerprint, window_started_at) DO UPDATE SET attempts=tenant.crm_capture_rate_limits.attempts+1 RETURNING attempts`,
    [form.organization_id, form.id, fingerprint, window],
  );
  if (Number(rate.rows[0].attempts) > Number(form.rate_limit_per_hour))
    throw new CrmError(429, "Too many submissions. Try again later.");
  for (const field of form.required_fields || [])
    if (!input[field] || String(input[field]).trim() === "")
      throw new CrmError(400, `${field} is required.`);
  const context = {
    organizationId: form.organization_id,
    userId: form.owner_user_id || null,
    activeCompanyId: form.company_id,
    activeBranchId: form.branch_id,
    allowAllCompanies: false,
  };
  if (!context.userId) {
    const owner = await client.query(
      `SELECT created_by FROM public.organizations WHERE id=$1`,
      [form.organization_id],
    );
    context.userId = owner.rows[0]?.created_by;
  }
  const duplicates = await findCrmDuplicates(client, context, input);
  const settings = await client.query(
    `SELECT duplicate_policy FROM tenant.crm_settings WHERE organization_id=$1`,
    [form.organization_id],
  );
  if (settings.rows[0]?.duplicate_policy === "block" && duplicates.length)
    throw new CrmError(
      409,
      "A matching lead already exists.",
      "CRM_DUPLICATE_LEAD",
    );
  const lead = await createCrmRecord(client, context, "leads", {
    ...input,
    companyId: form.company_id,
    branchId: form.branch_id,
    sourceId: form.source_id,
    campaignId: form.campaign_id,
    ownerUserId: form.owner_user_id,
  });
  if (form.campaign_id)
    await client.query(
      `INSERT INTO tenant.crm_campaign_members (organization_id,campaign_id,lead_id,member_status,created_by) VALUES ($1,$2,$3,'responded',$4) ON CONFLICT DO NOTHING`,
      [form.organization_id, form.campaign_id, lead.id, context.userId],
    );
  return {
    message: form.success_message,
    leadId: lead.id,
    duplicateWarning: duplicates.length > 0,
  };
}
