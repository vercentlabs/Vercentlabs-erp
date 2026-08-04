import { createHash } from "node:crypto";

export const CRM_MARKETING_CAPABILITY_IDS = Object.freeze([
  "CRM-064",
  "CRM-065",
  "CRM-066",
  "CRM-067",
  "CRM-068",
  "CRM-069",
  "CRM-070",
  "CRM-071",
]);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHANNELS = new Set(["email", "sms", "mixed"]);
const SUBJECT_TYPES = new Set(["lead", "contact", "account"]);
const ATTRIBUTION_MODELS = new Set([
  "first_touch",
  "last_touch",
  "linear",
  "position_based",
  "time_decay",
]);

export class CrmMarketingError extends Error {
  constructor(status, message, code = "CRM_MARKETING_ERROR", details = []) {
    super(message);
    this.name = "CrmMarketingError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  return value;
}

export function crmMarketingHash(value) {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

function text(value, max = 4000) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolean(value) {
  return (
    value === true ||
    ["true", "1", "yes", "y"].includes(text(value).toLowerCase())
  );
}

function assertUuid(value, label) {
  if (!UUID.test(String(value || "")))
    throw new CrmMarketingError(400, `${label} is invalid.`);
  return String(value);
}

function assertContext(context) {
  assertUuid(context?.organizationId, "Organisation");
  assertUuid(context?.userId, "User");
}

function row(result, message = "Record not found.") {
  if (!result.rows[0]) throw new CrmMarketingError(404, message);
  return result.rows[0];
}

export function normalizeMarketingSegmentDefinition(input = {}) {
  const subjectType = text(input.subjectType || "lead").toLowerCase();
  if (!SUBJECT_TYPES.has(subjectType))
    throw new CrmMarketingError(400, "Segment subject type is invalid.");
  const segmentType = text(input.segmentType || "dynamic").toLowerCase();
  if (!["static", "dynamic"].includes(segmentType))
    throw new CrmMarketingError(400, "Segment type is invalid.");
  const filters =
    input.filters && typeof input.filters === "object" ? input.filters : {};
  const allowed = {
    lead: new Set([
      "status",
      "rating",
      "priority",
      "industry",
      "countryCode",
      "scoreMin",
      "scoreMax",
      "consentEmail",
      "consentSms",
      "createdAfter",
      "companyNameContains",
    ]),
    contact: new Set([
      "status",
      "emailPresent",
      "designationContains",
      "createdAfter",
    ]),
    account: new Set(["status", "partyType", "nameContains", "createdAfter"]),
  }[subjectType];
  const normalizedFilters = {};
  for (const [key, value] of Object.entries(filters)) {
    if (!allowed.has(key))
      throw new CrmMarketingError(
        400,
        `Unsupported ${subjectType} segment filter: ${key}.`,
      );
    if (value !== undefined && value !== null && value !== "")
      normalizedFilters[key] = value;
  }
  return {
    name: text(input.name, 200),
    description: text(input.description, 2000) || null,
    subjectType,
    segmentType,
    filters: normalizedFilters,
    companyId: input.companyId ? assertUuid(input.companyId, "Company") : null,
    status: ["active", "inactive", "archived"].includes(text(input.status))
      ? text(input.status)
      : "active",
  };
}

export function compileMarketingSegmentFilter(
  subjectType,
  filters = {},
  startIndex = 2,
) {
  const definition = normalizeMarketingSegmentDefinition({
    name: "compiled",
    subjectType,
    segmentType: "dynamic",
    filters,
  });
  const clauses = [];
  const values = [];
  const add = (column, operator, value) => {
    values.push(value);
    clauses.push(`${column} ${operator} $${startIndex + values.length - 1}`);
  };
  if (definition.subjectType === "lead") {
    if (filters.status) add("subject.status", "=", text(filters.status));
    if (filters.rating) add("subject.rating", "=", text(filters.rating));
    if (filters.priority) add("subject.priority", "=", text(filters.priority));
    if (filters.industry)
      add("lower(subject.industry)", "=", text(filters.industry).toLowerCase());
    if (filters.countryCode)
      add(
        "subject.country_code",
        "=",
        text(filters.countryCode, 2).toUpperCase(),
      );
    if (filters.scoreMin !== undefined)
      add("subject.score", ">=", number(filters.scoreMin));
    if (filters.scoreMax !== undefined)
      add("subject.score", "<=", number(filters.scoreMax));
    if (filters.consentEmail !== undefined)
      add("subject.consent_email", "=", boolean(filters.consentEmail));
    if (filters.consentSms !== undefined)
      add("subject.consent_sms", "=", boolean(filters.consentSms));
    if (filters.createdAfter)
      add(
        "subject.created_at",
        ">=",
        new Date(String(filters.createdAfter)).toISOString(),
      );
    if (filters.companyNameContains)
      add(
        "lower(subject.company_name)",
        "LIKE",
        `%${text(filters.companyNameContains).toLowerCase()}%`,
      );
  } else if (definition.subjectType === "contact") {
    if (filters.status) add("subject.status", "=", text(filters.status));
    if (filters.emailPresent !== undefined)
      clauses.push(
        boolean(filters.emailPresent)
          ? "subject.email IS NOT NULL AND subject.email <> ''"
          : "(subject.email IS NULL OR subject.email = '')",
      );
    if (filters.designationContains)
      add(
        "lower(subject.designation)",
        "LIKE",
        `%${text(filters.designationContains).toLowerCase()}%`,
      );
    if (filters.createdAfter)
      add(
        "subject.created_at",
        ">=",
        new Date(String(filters.createdAfter)).toISOString(),
      );
  } else {
    if (filters.status) add("subject.status", "=", text(filters.status));
    if (filters.partyType)
      add("subject.party_type", "=", text(filters.partyType));
    if (filters.nameContains)
      add(
        "lower(subject.display_name)",
        "LIKE",
        `%${text(filters.nameContains).toLowerCase()}%`,
      );
    if (filters.createdAfter)
      add(
        "subject.created_at",
        ">=",
        new Date(String(filters.createdAfter)).toISOString(),
      );
  }
  return {
    clause: clauses.length ? ` AND ${clauses.join(" AND ")}` : "",
    values,
  };
}

export function normalizeJourneyDefinition(input = {}) {
  const steps = Array.isArray(input.steps) ? input.steps : [];
  if (!steps.length)
    throw new CrmMarketingError(400, "A journey requires at least one step.");
  if (steps.length > 100)
    throw new CrmMarketingError(413, "A journey is limited to 100 steps.");
  const keys = new Set();
  const normalized = steps.map((raw, index) => {
    const step = raw && typeof raw === "object" ? raw : {};
    const key = text(step.key || `step_${index + 1}`, 80);
    if (!key || keys.has(key))
      throw new CrmMarketingError(
        400,
        `Journey step key ${key || index + 1} is duplicated.`,
      );
    keys.add(key);
    const type = text(step.type).toLowerCase();
    if (
      ![
        "email",
        "sms",
        "wait",
        "condition",
        "update_member",
        "create_activity",
        "exit",
      ].includes(type)
    )
      throw new CrmMarketingError(
        400,
        `Unsupported journey step type: ${type}.`,
      );
    return {
      key,
      sequence: index + 1,
      type,
      configuration:
        step.configuration && typeof step.configuration === "object"
          ? step.configuration
          : {},
      nextStepKey: text(step.nextStepKey, 80) || null,
      trueStepKey: text(step.trueStepKey, 80) || null,
      falseStepKey: text(step.falseStepKey, 80) || null,
    };
  });
  for (const step of normalized) {
    for (const next of [step.nextStepKey, step.trueStepKey, step.falseStepKey])
      if (next && !keys.has(next))
        throw new CrmMarketingError(
          400,
          `Journey step ${step.key} references missing step ${next}.`,
        );
  }
  return {
    name: text(input.name, 200),
    entrySegmentId: input.entrySegmentId
      ? assertUuid(input.entrySegmentId, "Entry segment")
      : null,
    entryCriteria:
      input.entryCriteria && typeof input.entryCriteria === "object"
        ? input.entryCriteria
        : {},
    exitCriteria:
      input.exitCriteria && typeof input.exitCriteria === "object"
        ? input.exitCriteria
        : {},
    status: ["draft", "active", "paused", "completed", "archived"].includes(
      text(input.status),
    )
      ? text(input.status)
      : "draft",
    steps: normalized,
  };
}

export function assignMarketingExperimentVariant(subjectKey, variants) {
  const normalized = (Array.isArray(variants) ? variants : []).map(
    (variant) => ({
      key: text(variant.key || variant.variantKey, 80),
      weight: Math.max(1, Math.floor(number(variant.weight, 1))),
    }),
  );
  if (normalized.length < 2)
    throw new CrmMarketingError(
      400,
      "An experiment requires at least two variants.",
    );
  if (normalized.some((variant) => !variant.key))
    throw new CrmMarketingError(
      400,
      "Every experiment variant requires a key.",
    );
  const total = normalized.reduce((sum, variant) => sum + variant.weight, 0);
  const bucket =
    Number.parseInt(crmMarketingHash(String(subjectKey)).slice(0, 8), 16) %
    total;
  let cursor = 0;
  for (const variant of normalized) {
    cursor += variant.weight;
    if (bucket < cursor) return variant.key;
  }
  return normalized.at(-1).key;
}

export function calculateMarketingAttributionWeights(
  touchpoints,
  model = "linear",
) {
  const points = Array.isArray(touchpoints) ? touchpoints : [];
  if (!points.length) return [];
  if (!ATTRIBUTION_MODELS.has(model))
    throw new CrmMarketingError(400, "Attribution model is invalid.");
  let raw;
  if (model === "first_touch")
    raw = points.map((_, index) => (index === 0 ? 1 : 0));
  else if (model === "last_touch")
    raw = points.map((_, index) => (index === points.length - 1 ? 1 : 0));
  else if (model === "position_based" && points.length > 2)
    raw = points.map((_, index) =>
      index === 0 || index === points.length - 1
        ? 0.4
        : 0.2 / (points.length - 2),
    );
  else if (model === "time_decay") raw = points.map((_, index) => 2 ** index);
  else raw = points.map(() => 1);
  const total = raw.reduce((sum, weight) => sum + weight, 0);
  return points.map((point, index) => ({
    ...point,
    weight: total ? raw[index] / total : 0,
  }));
}

export function evaluateMarketingFrequencyPolicy(input = {}) {
  const channel = text(input.channel).toLowerCase();
  const destination = text(input.destination, 320);
  if (!["email", "sms"].includes(channel) || !destination)
    return { eligible: false, reason: "invalid_destination" };
  if (boolean(input.doNotContact))
    return { eligible: false, reason: "do_not_contact" };
  if (boolean(input.suppressed))
    return { eligible: false, reason: "suppressed" };
  if (channel === "email" && !boolean(input.consentEmail))
    return { eligible: false, reason: "email_consent_required" };
  if (channel === "sms" && !boolean(input.consentSms))
    return { eligible: false, reason: "sms_consent_required" };
  const count = Math.max(0, Math.floor(number(input.messagesInWindow)));
  const maximum = Math.max(1, Math.floor(number(input.maximumMessages, 5)));
  if (count >= maximum) return { eligible: false, reason: "frequency_cap" };
  const hour = Number.isFinite(Number(input.localHour))
    ? Number(input.localHour)
    : new Date().getUTCHours();
  const quietStart = Number(input.quietStartHour);
  const quietEnd = Number(input.quietEndHour);
  if (Number.isFinite(quietStart) && Number.isFinite(quietEnd)) {
    const quiet =
      quietStart <= quietEnd
        ? hour >= quietStart && hour < quietEnd
        : hour >= quietStart || hour < quietEnd;
    if (quiet) return { eligible: false, reason: "quiet_hours" };
  }
  return { eligible: true, reason: null };
}

export function validateMarketingSurveyDefinition(input = {}) {
  const questions = Array.isArray(input.questions) ? input.questions : [];
  if (!questions.length)
    throw new CrmMarketingError(
      400,
      "A survey requires at least one question.",
    );
  if (questions.length > 100)
    throw new CrmMarketingError(413, "A survey is limited to 100 questions.");
  const keys = new Set();
  return {
    questions: questions.map((raw, index) => {
      const question = raw && typeof raw === "object" ? raw : {};
      const key = text(question.key || `q${index + 1}`, 80);
      if (keys.has(key))
        throw new CrmMarketingError(
          400,
          `Survey question key ${key} is duplicated.`,
        );
      keys.add(key);
      const type = text(question.type || "text").toLowerCase();
      if (
        ![
          "text",
          "long_text",
          "single_choice",
          "multiple_choice",
          "rating",
          "nps",
          "csat",
        ].includes(type)
      )
        throw new CrmMarketingError(
          400,
          `Unsupported survey question type: ${type}.`,
        );
      const options = Array.isArray(question.options)
        ? question.options.map((option) => text(option, 200)).filter(Boolean)
        : [];
      if (
        ["single_choice", "multiple_choice"].includes(type) &&
        options.length < 2
      )
        throw new CrmMarketingError(
          400,
          `${key} requires at least two options.`,
        );
      return {
        key,
        label: text(question.label, 500) || key,
        type,
        required: boolean(question.required),
        options,
      };
    }),
  };
}

export function buildMarketingDeliveryCommand(input = {}) {
  const channel = text(input.channel).toLowerCase();
  if (!["email", "sms"].includes(channel))
    throw new CrmMarketingError(400, "Delivery channel is invalid.");
  const destination = text(input.destination, 320);
  if (!destination)
    throw new CrmMarketingError(400, "Delivery destination is required.");
  const provider = text(input.provider || "mock", 80).toLowerCase();
  return {
    provider,
    channel,
    destination,
    subject: channel === "email" ? text(input.subject, 500) : null,
    body: text(input.body, channel === "sms" ? 1600 : 100000),
    idempotencyKey: crmMarketingHash({
      campaignRunId: input.campaignRunId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      channel,
    }),
    metadata:
      input.metadata && typeof input.metadata === "object"
        ? input.metadata
        : {},
  };
}

export async function saveMarketingSegment(client, context, input = {}) {
  assertContext(context);
  const definition = normalizeMarketingSegmentDefinition(input);
  if (!definition.name)
    throw new CrmMarketingError(400, "Segment name is required.");
  const result = input.id
    ? await client.query(
        `UPDATE tenant.crm_marketing_segments
            SET name=$3,description=$4,subject_type=$5,segment_type=$6,filter_definition=$7::jsonb,
                company_id=$8,status=$9,updated_by=$2,updated_at=now(),refresh_status='pending'
          WHERE organization_id=$1 AND id=$10 RETURNING *`,
        [
          context.organizationId,
          context.userId,
          definition.name,
          definition.description,
          definition.subjectType,
          definition.segmentType,
          JSON.stringify(definition.filters),
          definition.companyId,
          definition.status,
          assertUuid(input.id, "Segment"),
        ],
      )
    : await client.query(
        `INSERT INTO tenant.crm_marketing_segments(
           organization_id,company_id,name,description,subject_type,segment_type,filter_definition,status,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$9) RETURNING *`,
        [
          context.organizationId,
          definition.companyId,
          definition.name,
          definition.description,
          definition.subjectType,
          definition.segmentType,
          JSON.stringify(definition.filters),
          definition.status,
          context.userId,
        ],
      );
  return row(result, "Marketing segment not found.");
}

export async function refreshMarketingSegment(client, context, segmentId) {
  assertContext(context);
  assertUuid(segmentId, "Segment");
  const segment = row(
    await client.query(
      `SELECT * FROM tenant.crm_marketing_segments WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [context.organizationId, segmentId],
    ),
    "Marketing segment not found.",
  );
  if (segment.segment_type === "static") {
    const count = row(
      await client.query(
        `SELECT count(*)::int AS count FROM tenant.crm_marketing_segment_members WHERE organization_id=$1 AND segment_id=$2 AND exited_at IS NULL`,
        [context.organizationId, segmentId],
      ),
    ).count;
    return row(
      await client.query(
        `UPDATE tenant.crm_marketing_segments SET member_count=$3,refresh_status='ready',refreshed_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
        [context.organizationId, segmentId, count],
      ),
    );
  }
  await client.query(
    `UPDATE tenant.crm_marketing_segments SET refresh_status='running',updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, segmentId],
  );
  await client.query(
    `DELETE FROM tenant.crm_marketing_segment_members WHERE organization_id=$1 AND segment_id=$2 AND source='dynamic'`,
    [context.organizationId, segmentId],
  );
  const compiled = compileMarketingSegmentFilter(
    segment.subject_type,
    segment.filter_definition || {},
    2,
  );
  let sourceSql;
  if (segment.subject_type === "lead") {
    sourceSql = `SELECT subject.id,subject.email,COALESCE(subject.mobile,subject.phone) AS mobile,
                        subject.consent_email,subject.consent_sms,subject.do_not_contact
                   FROM tenant.crm_leads subject
                  WHERE subject.organization_id=$1 AND subject.status<>'archived'${compiled.clause}`;
  } else if (segment.subject_type === "contact") {
    sourceSql = `SELECT subject.id,subject.email,COALESCE(subject.mobile,subject.phone) AS mobile,
                        false AS consent_email,false AS consent_sms,false AS do_not_contact
                   FROM tenant.contacts subject
                  WHERE subject.organization_id=$1${compiled.clause}`;
  } else {
    sourceSql = `SELECT subject.id,primary_contact.email,COALESCE(primary_contact.mobile,primary_contact.phone) AS mobile,
                        false AS consent_email,false AS consent_sms,false AS do_not_contact
                   FROM tenant.business_parties subject
              LEFT JOIN LATERAL (
                     SELECT contact.email,contact.mobile,contact.phone
                       FROM tenant.contacts contact
                      WHERE contact.organization_id=subject.organization_id AND contact.party_id=subject.id AND contact.status='active'
                      ORDER BY contact.is_primary DESC,contact.created_at LIMIT 1
                   ) primary_contact ON true
                  WHERE subject.organization_id=$1${compiled.clause}`;
  }
  const candidates = await client.query(sourceSql, [
    context.organizationId,
    ...compiled.values,
  ]);
  for (const candidate of candidates.rows) {
    const reason = candidate.do_not_contact ? "do_not_contact" : null;
    await client.query(
      `INSERT INTO tenant.crm_marketing_segment_members(
         organization_id,segment_id,subject_type,subject_id,email,mobile,consent_email,consent_sms,suppression_reason,source,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'dynamic',$10)
       ON CONFLICT (organization_id,segment_id,subject_type,subject_id)
       DO UPDATE SET email=EXCLUDED.email,mobile=EXCLUDED.mobile,consent_email=EXCLUDED.consent_email,
                     consent_sms=EXCLUDED.consent_sms,suppression_reason=EXCLUDED.suppression_reason,exited_at=NULL`,
      [
        context.organizationId,
        segmentId,
        segment.subject_type,
        candidate.id,
        candidate.email,
        candidate.mobile,
        candidate.consent_email,
        candidate.consent_sms,
        reason,
        context.userId,
      ],
    );
  }
  return row(
    await client.query(
      `UPDATE tenant.crm_marketing_segments SET member_count=$3,refresh_status='ready',refreshed_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
      [context.organizationId, segmentId, candidates.rows.length],
    ),
  );
}

export async function saveMarketingCampaign(client, context, input = {}) {
  assertContext(context);
  const campaignId = input.id ? assertUuid(input.id, "Campaign") : null;
  const segmentId = input.segmentId
    ? assertUuid(input.segmentId, "Segment")
    : null;
  const model = text(input.attributionModel || "linear").toLowerCase();
  if (!ATTRIBUTION_MODELS.has(model))
    throw new CrmMarketingError(400, "Attribution model is invalid.");
  if (!text(input.name))
    throw new CrmMarketingError(400, "Campaign name is required.");
  if (segmentId) {
    const visible = await client.query(
      `SELECT 1 FROM tenant.crm_marketing_segments WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, segmentId],
    );
    if (!visible.rows[0])
      throw new CrmMarketingError(
        409,
        "Campaign segment is outside the active organisation.",
      );
  }
  if (campaignId) {
    return row(
      await client.query(
        `UPDATE tenant.crm_campaigns SET name=$3,campaign_type=$4,status=$5,objective=$6,primary_segment_id=$7,
       channel_mix=$8::jsonb,frequency_policy=$9::jsonb,attribution_model=$10,scheduled_at=$11,
       budget=$12,expected_revenue=$13,updated_by=$2,updated_at=now()
       WHERE organization_id=$1 AND id=$14 RETURNING *`,
        [
          context.organizationId,
          context.userId,
          text(input.name, 240),
          text(input.campaignType || "email"),
          text(input.status || "planned"),
          text(input.objective, 2000) || null,
          segmentId,
          JSON.stringify(input.channels || ["email"]),
          JSON.stringify(input.frequencyPolicy || {}),
          model,
          input.scheduledAt || null,
          Math.max(0, number(input.budget)),
          Math.max(0, number(input.expectedRevenue)),
          campaignId,
        ],
      ),
      "Campaign not found.",
    );
  }
  const code = text(input.code, 80) || `MKT-${Date.now()}`;
  return row(
    await client.query(
      `INSERT INTO tenant.crm_campaigns(
       organization_id,company_id,code,name,campaign_type,status,objective,primary_segment_id,channel_mix,
       frequency_policy,attribution_model,scheduled_at,budget,expected_revenue,owner_user_id,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16,$16) RETURNING *`,
      [
        context.organizationId,
        context.activeCompanyId || null,
        code,
        text(input.name, 240),
        text(input.campaignType || "email"),
        text(input.status || "planned"),
        text(input.objective, 2000) || null,
        segmentId,
        JSON.stringify(input.channels || ["email"]),
        JSON.stringify(input.frequencyPolicy || {}),
        model,
        input.scheduledAt || null,
        Math.max(0, number(input.budget)),
        Math.max(0, number(input.expectedRevenue)),
        context.userId,
        context.userId,
      ],
    ),
  );
}

export async function createMarketingCampaignRun(client, context, input = {}) {
  assertContext(context);
  const campaignId = assertUuid(input.campaignId, "Campaign");
  const channel = text(input.channel || "email").toLowerCase();
  if (!CHANNELS.has(channel))
    throw new CrmMarketingError(400, "Campaign channel is invalid.");
  const campaign = row(
    await client.query(
      `SELECT * FROM tenant.crm_campaigns WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [context.organizationId, campaignId],
    ),
    "Campaign not found.",
  );
  const segmentId = input.segmentId || campaign.primary_segment_id;
  assertUuid(segmentId, "Campaign segment");
  await refreshMarketingSegment(client, context, segmentId);
  const run = row(
    await client.query(
      `INSERT INTO tenant.crm_marketing_campaign_runs(
       organization_id,campaign_id,segment_id,channel,provider,scheduled_at,status,configuration,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$9) RETURNING *`,
      [
        context.organizationId,
        campaignId,
        segmentId,
        channel,
        text(input.provider || "mock", 80),
        input.scheduledAt || null,
        input.scheduledAt ? "scheduled" : "draft",
        JSON.stringify(input.configuration || {}),
        context.userId,
      ],
    ),
  );
  const channels = channel === "mixed" ? ["email", "sms"] : [channel];
  const members = await client.query(
    `SELECT * FROM tenant.crm_marketing_segment_members WHERE organization_id=$1 AND segment_id=$2 AND exited_at IS NULL`,
    [context.organizationId, segmentId],
  );
  for (const member of members.rows) {
    for (const deliveryChannel of channels) {
      const destination =
        deliveryChannel === "email" ? member.email : member.mobile;
      if (!destination) continue;
      const suppression =
        deliveryChannel === "email"
          ? await client.query(
              `SELECT 1 FROM tenant.crm_email_suppressions WHERE organization_id=$1 AND email_address=lower($2) AND status='active' AND (expires_at IS NULL OR expires_at>now()) LIMIT 1`,
              [context.organizationId, destination],
            )
          : { rows: [] };
      const recent = await client.query(
        `SELECT count(*)::int AS count FROM tenant.crm_marketing_deliveries
          WHERE organization_id=$1 AND subject_type=$2 AND subject_id=$3 AND channel=$4
            AND created_at >= now() - make_interval(hours => $5) AND status NOT IN ('suppressed','failed')`,
        [
          context.organizationId,
          member.subject_type,
          member.subject_id,
          deliveryChannel,
          Math.max(1, Math.floor(number(input.frequencyWindowHours, 24))),
        ],
      );
      const policy = evaluateMarketingFrequencyPolicy({
        channel: deliveryChannel,
        destination,
        consentEmail: member.consent_email,
        consentSms: member.consent_sms,
        suppressed:
          suppression.rows.length > 0 || Boolean(member.suppression_reason),
        messagesInWindow: recent.rows[0]?.count || 0,
        maximumMessages: input.maximumMessages || 5,
        quietStartHour: input.quietStartHour,
        quietEndHour: input.quietEndHour,
      });
      const content = buildMarketingDeliveryCommand({
        provider: run.provider,
        channel: deliveryChannel,
        destination,
        campaignRunId: run.id,
        subjectType: member.subject_type,
        subjectId: member.subject_id,
        subject: input.subject,
        body: input.body,
      });
      await client.query(
        `INSERT INTO tenant.crm_marketing_deliveries(
           organization_id,campaign_run_id,campaign_id,subject_type,subject_id,channel,destination,status,
           suppression_reason,payload,content_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
         ON CONFLICT (organization_id,campaign_run_id,subject_type,subject_id,channel) DO NOTHING`,
        [
          context.organizationId,
          run.id,
          campaignId,
          member.subject_type,
          member.subject_id,
          deliveryChannel,
          destination,
          policy.eligible ? "queued" : "suppressed",
          policy.reason,
          JSON.stringify(content),
          crmMarketingHash(content),
        ],
      );
    }
  }
  const counts = row(
    await client.query(
      `SELECT count(*)::int AS total,count(*) FILTER (WHERE status='queued')::int AS eligible FROM tenant.crm_marketing_deliveries WHERE organization_id=$1 AND campaign_run_id=$2`,
      [context.organizationId, run.id],
    ),
  );
  return row(
    await client.query(
      `UPDATE tenant.crm_marketing_campaign_runs SET total_recipients=$3,eligible_recipients=$4,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
      [context.organizationId, run.id, counts.total, counts.eligible],
    ),
  );
}

export async function processMarketingCampaignRun(client, context, runId) {
  assertContext(context);
  assertUuid(runId, "Campaign run");
  const run = row(
    await client.query(
      `SELECT * FROM tenant.crm_marketing_campaign_runs WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [context.organizationId, runId],
    ),
    "Campaign run not found.",
  );
  if (["completed", "cancelled"].includes(run.status)) return run;
  await client.query(
    `UPDATE tenant.crm_marketing_campaign_runs SET status='running',started_at=COALESCE(started_at,now()),updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, runId],
  );
  const queued = await client.query(
    `SELECT * FROM tenant.crm_marketing_deliveries WHERE organization_id=$1 AND campaign_run_id=$2 AND status='queued' ORDER BY created_at,id FOR UPDATE`,
    [context.organizationId, runId],
  );
  for (const delivery of queued.rows) {
    const providerMessageId = `${run.provider}-${delivery.id}`;
    const nextStatus = run.provider === "mock" ? "delivered" : "sent";
    await client.query(
      `UPDATE tenant.crm_marketing_deliveries SET status=$3,provider_message_id=$4,attempt_count=attempt_count+1,
       sent_at=now(),delivered_at=CASE WHEN $3='delivered' THEN now() ELSE delivered_at END,updated_at=now()
       WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, delivery.id, nextStatus, providerMessageId],
    );
    await recordMarketingTouchpoint(client, context, {
      subjectType: delivery.subject_type,
      subjectId: delivery.subject_id,
      campaignId: delivery.campaign_id,
      campaignRunId: runId,
      channel: delivery.channel,
      eventType: nextStatus,
      metadata: { providerMessageId },
    });
    await client.query(
      `INSERT INTO tenant.crm_campaign_members(organization_id,campaign_id,lead_id,contact_id,party_id,member_status,created_by)
       VALUES($1,$2,CASE WHEN $3='lead' THEN $4::uuid ELSE NULL END,CASE WHEN $3='contact' THEN $4::uuid ELSE NULL END,
              CASE WHEN $3='account' THEN $4::uuid ELSE NULL END,'sent',$5)
       ON CONFLICT DO NOTHING`,
      [
        context.organizationId,
        delivery.campaign_id,
        delivery.subject_type,
        delivery.subject_id,
        context.userId,
      ],
    );
  }
  const counts = row(
    await client.query(
      `SELECT count(*) FILTER (WHERE status IN ('sent','delivered','opened','clicked','responded'))::int AS sent,count(*) FILTER (WHERE status='delivered')::int AS delivered,count(*) FILTER (WHERE status='failed')::int AS failed FROM tenant.crm_marketing_deliveries WHERE organization_id=$1 AND campaign_run_id=$2`,
      [context.organizationId, runId],
    ),
  );
  return row(
    await client.query(
      `UPDATE tenant.crm_marketing_campaign_runs SET status='completed',completed_at=now(),sent_count=$3,delivered_count=$4,failure_count=$5,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
      [
        context.organizationId,
        runId,
        counts.sent,
        counts.delivered,
        counts.failed,
      ],
    ),
  );
}

export async function saveMarketingJourney(client, context, input = {}) {
  assertContext(context);
  const definition = normalizeJourneyDefinition(input);
  if (!definition.name)
    throw new CrmMarketingError(400, "Journey name is required.");
  const journey = row(
    await client.query(
      `INSERT INTO tenant.crm_marketing_journeys(
       organization_id,company_id,name,entry_segment_id,entry_criteria,exit_criteria,status,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$8) RETURNING *`,
      [
        context.organizationId,
        context.activeCompanyId || null,
        definition.name,
        definition.entrySegmentId,
        JSON.stringify(definition.entryCriteria),
        JSON.stringify(definition.exitCriteria),
        definition.status,
        context.userId,
      ],
    ),
  );
  for (const step of definition.steps)
    await client.query(
      `INSERT INTO tenant.crm_marketing_journey_steps(
         organization_id,journey_id,step_key,sequence,step_type,configuration,next_step_key,true_step_key,false_step_key)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
      [
        context.organizationId,
        journey.id,
        step.key,
        step.sequence,
        step.type,
        JSON.stringify(step.configuration),
        step.nextStepKey,
        step.trueStepKey,
        step.falseStepKey,
      ],
    );
  return { ...journey, steps: definition.steps };
}

export async function enrollMarketingJourney(client, context, input = {}) {
  assertContext(context);
  const journeyId = assertUuid(input.journeyId, "Journey");
  const subjectType = text(input.subjectType || "lead");
  if (!SUBJECT_TYPES.has(subjectType))
    throw new CrmMarketingError(400, "Journey subject type is invalid.");
  const subjectId = assertUuid(input.subjectId, "Journey subject");
  const first = row(
    await client.query(
      `SELECT step_key FROM tenant.crm_marketing_journey_steps WHERE organization_id=$1 AND journey_id=$2 ORDER BY sequence LIMIT 1`,
      [context.organizationId, journeyId],
    ),
    "Journey has no steps.",
  );
  return row(
    await client.query(
      `INSERT INTO tenant.crm_marketing_journey_enrollments(organization_id,journey_id,subject_type,subject_id,current_step_key,state)
     VALUES($1,$2,$3,$4,$5,$6::jsonb)
     ON CONFLICT (organization_id,journey_id,subject_type,subject_id)
     DO UPDATE SET status='active',current_step_key=EXCLUDED.current_step_key,state=EXCLUDED.state,exit_reason=NULL,completed_at=NULL,updated_at=now()
     RETURNING *`,
      [
        context.organizationId,
        journeyId,
        subjectType,
        subjectId,
        first.step_key,
        JSON.stringify(input.state || {}),
      ],
    ),
  );
}

export async function advanceMarketingJourney(
  client,
  context,
  enrollmentId,
  input = {},
) {
  assertContext(context);
  assertUuid(enrollmentId, "Journey enrollment");
  const enrollment = row(
    await client.query(
      `SELECT * FROM tenant.crm_marketing_journey_enrollments WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [context.organizationId, enrollmentId],
    ),
    "Journey enrollment not found.",
  );
  if (!["active", "waiting"].includes(enrollment.status)) return enrollment;
  const step = row(
    await client.query(
      `SELECT * FROM tenant.crm_marketing_journey_steps WHERE organization_id=$1 AND journey_id=$2 AND step_key=$3`,
      [
        context.organizationId,
        enrollment.journey_id,
        enrollment.current_step_key,
      ],
    ),
    "Current journey step not found.",
  );
  let next = step.next_step_key;
  let status = "active";
  let nextActionAt = null;
  if (step.step_type === "condition")
    next = boolean(input.conditionResult)
      ? step.true_step_key
      : step.false_step_key;
  if (step.step_type === "wait") {
    const minutes = Math.max(
      1,
      Math.floor(number(step.configuration?.minutes, 60)),
    );
    status = "waiting";
    nextActionAt = new Date(Date.now() + minutes * 60_000).toISOString();
  }
  if (step.step_type === "exit" || !next) status = "completed";
  return row(
    await client.query(
      `UPDATE tenant.crm_marketing_journey_enrollments SET current_step_key=$3,status=$4,next_action_at=$5,
     state=state||$6::jsonb,completed_at=CASE WHEN $4='completed' THEN now() ELSE completed_at END,updated_at=now()
     WHERE organization_id=$1 AND id=$2 RETURNING *`,
      [
        context.organizationId,
        enrollmentId,
        next,
        status,
        nextActionAt,
        JSON.stringify({
          lastStepKey: step.step_key,
          lastAdvancedAt: new Date().toISOString(),
        }),
      ],
    ),
  );
}

export async function saveMarketingExperiment(client, context, input = {}) {
  assertContext(context);
  const variants = Array.isArray(input.variants) ? input.variants : [];
  assignMarketingExperimentVariant("validation", variants);
  const totalWeight = variants.reduce(
    (sum, variant) => sum + Math.max(1, Math.floor(number(variant.weight, 1))),
    0,
  );
  if (totalWeight > 1000)
    throw new CrmMarketingError(
      400,
      "Experiment variant weights are too large.",
    );
  const experiment = row(
    await client.query(
      `INSERT INTO tenant.crm_marketing_experiments(
       organization_id,campaign_id,name,experiment_type,allocation_strategy,winning_metric,status,created_by)
     VALUES($1,$2,$3,$4,'deterministic',$5,$6,$7) RETURNING *`,
      [
        context.organizationId,
        input.campaignId ? assertUuid(input.campaignId, "Campaign") : null,
        text(input.name, 200),
        variants.length > 2 ? "multivariate" : "ab",
        text(input.winningMetric || "response_rate"),
        text(input.status || "draft"),
        context.userId,
      ],
    ),
  );
  for (const variant of variants)
    await client.query(
      `INSERT INTO tenant.crm_marketing_experiment_variants(organization_id,experiment_id,variant_key,weight,content)
       VALUES($1,$2,$3,$4,$5::jsonb)`,
      [
        context.organizationId,
        experiment.id,
        text(variant.key || variant.variantKey, 80),
        Math.max(1, Math.floor(number(variant.weight, 1))),
        JSON.stringify(variant.content || {}),
      ],
    );
  return { ...experiment, variants };
}

export async function saveMarketingEvent(client, context, input = {}) {
  assertContext(context);
  const startsAt = new Date(String(input.startsAt));
  const endsAt = new Date(String(input.endsAt));
  if (
    !Number.isFinite(startsAt.getTime()) ||
    !Number.isFinite(endsAt.getTime()) ||
    endsAt <= startsAt
  )
    throw new CrmMarketingError(400, "Event start and end times are invalid.");
  return row(
    await client.query(
      `INSERT INTO tenant.crm_marketing_events(
       organization_id,campaign_id,event_type,name,description,starts_at,ends_at,capacity,provider,status,follow_up_configuration,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$12) RETURNING *`,
      [
        context.organizationId,
        input.campaignId ? assertUuid(input.campaignId, "Campaign") : null,
        text(input.eventType || "event"),
        text(input.name, 240),
        text(input.description, 4000) || null,
        startsAt.toISOString(),
        endsAt.toISOString(),
        input.capacity ? Math.floor(number(input.capacity)) : null,
        text(input.provider || "native", 80),
        text(input.status || "draft"),
        JSON.stringify(input.followUp || {}),
        context.userId,
      ],
    ),
  );
}

export async function registerMarketingEvent(
  client,
  context,
  eventId,
  input = {},
) {
  assertContext(context);
  assertUuid(eventId, "Marketing event");
  const emailAddress = text(input.email, 320).toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(emailAddress))
    throw new CrmMarketingError(400, "A valid registration email is required.");
  const event = row(
    await client.query(
      `SELECT * FROM tenant.crm_marketing_events WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [context.organizationId, eventId],
    ),
    "Marketing event not found.",
  );
  const current = row(
    await client.query(
      `SELECT count(*)::int AS count FROM tenant.crm_marketing_event_registrations WHERE organization_id=$1 AND event_id=$2 AND registration_status NOT IN ('cancelled')`,
      [context.organizationId, eventId],
    ),
  );
  const registrationStatus =
    event.capacity && Number(current.count) >= Number(event.capacity)
      ? "waitlisted"
      : "registered";
  const registration = row(
    await client.query(
      `INSERT INTO tenant.crm_marketing_event_registrations(
       organization_id,event_id,subject_type,subject_id,name,email,mobile,consent_email,registration_status,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     ON CONFLICT (organization_id,event_id,email) DO UPDATE SET name=EXCLUDED.name,mobile=EXCLUDED.mobile,
       consent_email=EXCLUDED.consent_email,registration_status=EXCLUDED.registration_status,metadata=EXCLUDED.metadata
     RETURNING *`,
      [
        context.organizationId,
        eventId,
        text(input.subjectType || "external"),
        input.subjectId || null,
        text(input.name, 240),
        emailAddress,
        text(input.mobile, 40) || null,
        boolean(input.consentEmail),
        registrationStatus,
        JSON.stringify(input.metadata || {}),
      ],
    ),
  );
  if (event.campaign_id && input.subjectId)
    await recordMarketingTouchpoint(client, context, {
      subjectType: input.subjectType || "lead",
      subjectId: input.subjectId,
      campaignId: event.campaign_id,
      channel: event.event_type,
      eventType: "registered",
      metadata: { eventId },
    });
  return registration;
}

export async function saveMarketingSurvey(client, context, input = {}) {
  assertContext(context);
  const schema = validateMarketingSurveyDefinition(input);
  return row(
    await client.query(
      `INSERT INTO tenant.crm_marketing_surveys(
       organization_id,campaign_id,name,description,survey_schema,status,anonymous_allowed,published_at,closes_at,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,CASE WHEN $6='published' THEN now() ELSE NULL END,$8,$9,$9) RETURNING *`,
      [
        context.organizationId,
        input.campaignId ? assertUuid(input.campaignId, "Campaign") : null,
        text(input.name, 240),
        text(input.description, 4000) || null,
        JSON.stringify(schema),
        text(input.status || "draft"),
        boolean(input.anonymousAllowed),
        input.closesAt || null,
        context.userId,
      ],
    ),
  );
}

export async function submitMarketingSurveyResponse(
  client,
  context,
  survey,
  input = {},
) {
  assertContext(context);
  const schema = validateMarketingSurveyDefinition(
    survey.survey_schema || survey.surveySchema || {},
  );
  const answers =
    input.answers && typeof input.answers === "object" ? input.answers : {};
  const missing = schema.questions
    .filter(
      (question) =>
        question.required &&
        (answers[question.key] === undefined || answers[question.key] === ""),
    )
    .map((question) => question.key);
  if (missing.length)
    throw new CrmMarketingError(
      400,
      "Required survey answers are missing.",
      "CRM_MARKETING_SURVEY_INVALID",
      missing.map((field) => ({ field })),
    );
  const responseKey =
    text(input.responseKey, 160) ||
    crmMarketingHash({
      surveyId: survey.id || survey.survey_id,
      subjectId: input.subjectId,
      email: input.email,
      answers,
    });
  let score = null;
  for (const question of schema.questions)
    if (
      ["rating", "nps", "csat"].includes(question.type) &&
      Number.isFinite(Number(answers[question.key]))
    )
      score = Number(answers[question.key]);
  const sentiment =
    score === null
      ? null
      : score >= 8
        ? "positive"
        : score >= 5
          ? "neutral"
          : "negative";
  return row(
    await client.query(
      `INSERT INTO tenant.crm_marketing_survey_responses(
       organization_id,survey_id,response_key,subject_type,subject_id,respondent_email,answers,score,sentiment,content_hash)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
     ON CONFLICT (organization_id,survey_id,response_key) DO UPDATE SET answers=EXCLUDED.answers,score=EXCLUDED.score,
       sentiment=EXCLUDED.sentiment,submitted_at=now(),content_hash=EXCLUDED.content_hash RETURNING *`,
      [
        context.organizationId,
        survey.id || survey.survey_id,
        responseKey,
        input.subjectType || null,
        input.subjectId || null,
        text(input.email, 320).toLowerCase() || null,
        JSON.stringify(answers),
        score,
        sentiment,
        crmMarketingHash(answers),
      ],
    ),
  );
}

export async function recordMarketingTouchpoint(client, context, input = {}) {
  assertContext(context);
  const subjectType = text(input.subjectType);
  if (![...SUBJECT_TYPES, "opportunity"].includes(subjectType))
    throw new CrmMarketingError(400, "Touchpoint subject type is invalid.");
  const subjectId = assertUuid(input.subjectId, "Touchpoint subject");
  const eventType = text(input.eventType);
  if (
    ![
      "impression",
      "sent",
      "delivered",
      "opened",
      "clicked",
      "responded",
      "registered",
      "attended",
      "surveyed",
      "converted",
      "revenue",
    ].includes(eventType)
  )
    throw new CrmMarketingError(400, "Touchpoint event type is invalid.");
  const content = {
    subjectType,
    subjectId,
    campaignId: input.campaignId || null,
    campaignRunId: input.campaignRunId || null,
    channel: text(input.channel, 80),
    eventType,
    eventAt: input.eventAt || new Date().toISOString(),
    revenue: Math.max(0, number(input.revenue)),
    metadata: input.metadata || {},
  };
  return row(
    await client.query(
      `INSERT INTO tenant.crm_marketing_touchpoints(
       organization_id,subject_type,subject_id,campaign_id,campaign_run_id,channel,event_type,event_at,revenue,metadata,content_hash)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11) RETURNING *`,
      [
        context.organizationId,
        subjectType,
        subjectId,
        input.campaignId || null,
        input.campaignRunId || null,
        content.channel,
        eventType,
        content.eventAt,
        content.revenue,
        JSON.stringify(content.metadata),
        crmMarketingHash(content),
      ],
    ),
  );
}

export async function getMarketingAttributionReport(
  client,
  context,
  input = {},
) {
  assertContext(context);
  const subjectType = text(input.subjectType || "lead");
  const subjectId = assertUuid(input.subjectId, "Attribution subject");
  const model = text(input.model || "linear");
  const result = await client.query(
    `SELECT touchpoint.*,campaign.name AS campaign_name
       FROM tenant.crm_marketing_touchpoints touchpoint
  LEFT JOIN tenant.crm_campaigns campaign ON campaign.organization_id=touchpoint.organization_id AND campaign.id=touchpoint.campaign_id
      WHERE touchpoint.organization_id=$1 AND touchpoint.subject_type=$2 AND touchpoint.subject_id=$3
      ORDER BY touchpoint.event_at,touchpoint.id`,
    [context.organizationId, subjectType, subjectId],
  );
  const weighted = calculateMarketingAttributionWeights(result.rows, model);
  const conversionRevenue = result.rows
    .filter(
      (entry) =>
        entry.event_type === "revenue" || entry.event_type === "converted",
    )
    .reduce((sum, entry) => sum + number(entry.revenue), 0);
  const byCampaign = {};
  for (const point of weighted) {
    const key = point.campaign_id || "unattributed";
    byCampaign[key] ||= {
      campaignId: point.campaign_id || null,
      campaignName: point.campaign_name || "Unattributed",
      weight: 0,
      attributedRevenue: 0,
      touchpoints: 0,
    };
    byCampaign[key].weight += point.weight;
    byCampaign[key].attributedRevenue += conversionRevenue * point.weight;
    byCampaign[key].touchpoints += 1;
  }
  return {
    subjectType,
    subjectId,
    model,
    totalRevenue: conversionRevenue,
    touchpoints: weighted,
    campaigns: Object.values(byCampaign),
  };
}

export async function getMarketingDashboard(client, context) {
  assertContext(context);
  const [summary, campaigns, journeys, events, surveys, segments] =
    await Promise.all([
      client.query(
        `SELECT
         (SELECT count(*)::int FROM tenant.crm_marketing_segments WHERE organization_id=$1 AND status='active') AS active_segments,
         (SELECT count(*)::int FROM tenant.crm_marketing_campaign_runs WHERE organization_id=$1 AND status IN ('scheduled','running')) AS active_runs,
         (SELECT count(*)::int FROM tenant.crm_marketing_deliveries WHERE organization_id=$1 AND status='delivered') AS delivered,
         (SELECT count(*)::int FROM tenant.crm_marketing_journey_enrollments WHERE organization_id=$1 AND status IN ('active','waiting')) AS active_enrollments,
         (SELECT count(*)::int FROM tenant.crm_marketing_event_registrations WHERE organization_id=$1 AND registration_status IN ('registered','confirmed','attended')) AS registrations,
         (SELECT count(*)::int FROM tenant.crm_marketing_survey_responses WHERE organization_id=$1) AS survey_responses,
         (SELECT COALESCE(sum(revenue),0) FROM tenant.crm_marketing_touchpoints WHERE organization_id=$1 AND event_type='revenue') AS influenced_revenue`,
        [context.organizationId],
      ),
      client.query(
        `SELECT campaign.id,campaign.code,campaign.name,campaign.status,campaign.attribution_model,campaign.budget,campaign.actual_cost,campaign.expected_revenue,
      count(DISTINCT run.id)::int AS runs,COALESCE(sum(run.sent_count),0)::int AS sent,COALESCE(sum(run.response_count),0)::int AS responses
      FROM tenant.crm_campaigns campaign LEFT JOIN tenant.crm_marketing_campaign_runs run ON run.organization_id=campaign.organization_id AND run.campaign_id=campaign.id
      WHERE campaign.organization_id=$1 GROUP BY campaign.id ORDER BY campaign.updated_at DESC LIMIT 20`,
        [context.organizationId],
      ),
      client.query(
        `SELECT journey.id,journey.name,journey.status,journey.version,count(enrollment.id)::int AS enrollments,count(enrollment.id) FILTER (WHERE enrollment.status='completed')::int AS completed FROM tenant.crm_marketing_journeys journey LEFT JOIN tenant.crm_marketing_journey_enrollments enrollment ON enrollment.organization_id=journey.organization_id AND enrollment.journey_id=journey.id WHERE journey.organization_id=$1 GROUP BY journey.id ORDER BY journey.updated_at DESC LIMIT 20`,
        [context.organizationId],
      ),
      client.query(
        `SELECT event.id,event.name,event.event_type,event.status,event.starts_at,event.ends_at,count(registration.id)::int AS registrations,count(registration.id) FILTER (WHERE registration.registration_status='attended')::int AS attendees FROM tenant.crm_marketing_events event LEFT JOIN tenant.crm_marketing_event_registrations registration ON registration.organization_id=event.organization_id AND registration.event_id=event.id WHERE event.organization_id=$1 GROUP BY event.id ORDER BY event.starts_at DESC LIMIT 20`,
        [context.organizationId],
      ),
      client.query(
        `SELECT survey.id,survey.name,survey.status,survey.published_at,count(response.id)::int AS responses,avg(response.score) AS average_score FROM tenant.crm_marketing_surveys survey LEFT JOIN tenant.crm_marketing_survey_responses response ON response.organization_id=survey.organization_id AND response.survey_id=survey.id WHERE survey.organization_id=$1 GROUP BY survey.id ORDER BY survey.updated_at DESC LIMIT 20`,
        [context.organizationId],
      ),
      client.query(
        `SELECT id,name,subject_type,segment_type,status,member_count,refresh_status,refreshed_at FROM tenant.crm_marketing_segments WHERE organization_id=$1 ORDER BY updated_at DESC LIMIT 20`,
        [context.organizationId],
      ),
    ]);
  return {
    summary: summary.rows[0] || {},
    campaigns: campaigns.rows,
    journeys: journeys.rows,
    events: events.rows,
    surveys: surveys.rows,
    segments: segments.rows,
  };
}

export async function recordCrmMarketingAcceptance(
  client,
  context,
  input = {},
) {
  assertContext(context);
  if (!CRM_MARKETING_CAPABILITY_IDS.includes(input.capabilityId))
    throw new CrmMarketingError(400, "CRM marketing capability ID is invalid.");
  const status = ["passed", "failed", "blocked"].includes(text(input.status))
    ? text(input.status)
    : "failed";
  const commitSha = text(input.commitSha || "unknown", 120);
  const evidence =
    input.evidence && typeof input.evidence === "object" ? input.evidence : {};
  const providerAcceptance = ["sandbox", "production", "not_required"].includes(
    text(input.providerAcceptance),
  )
    ? text(input.providerAcceptance)
    : "sandbox";
  return row(
    await client.query(
      `INSERT INTO tenant.crm_marketing_acceptance_runs(
       organization_id,capability_id,commit_sha,status,evidence,evidence_hash,provider_acceptance,recorded_by)
     VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
     ON CONFLICT (organization_id,capability_id,commit_sha) DO NOTHING RETURNING *`,
      [
        context.organizationId,
        input.capabilityId,
        commitSha,
        status,
        JSON.stringify(evidence),
        crmMarketingHash({
          capabilityId: input.capabilityId,
          commitSha,
          status,
          evidence,
          providerAcceptance,
        }),
        providerAcceptance,
        context.userId,
      ],
    ),
    "Acceptance evidence already exists for this commit.",
  );
}

export async function getCrmMarketingReadiness(
  client,
  context,
  commitSha = null,
) {
  assertContext(context);
  const result = await client.query(
    `SELECT DISTINCT ON (capability_id) capability_id,status,provider_acceptance,recorded_at
       FROM tenant.crm_marketing_acceptance_runs
      WHERE organization_id=$1 AND ($2::text IS NULL OR commit_sha=$2)
      ORDER BY capability_id,recorded_at DESC`,
    [context.organizationId, commitSha],
  );
  const map = new Map(result.rows.map((entry) => [entry.capability_id, entry]));
  const capabilities = CRM_MARKETING_CAPABILITY_IDS.map((capabilityId) => ({
    capabilityId,
    status: map.get(capabilityId)?.status || "missing",
    providerAcceptance: map.get(capabilityId)?.provider_acceptance || "missing",
    recordedAt: map.get(capabilityId)?.recorded_at || null,
  }));
  const passed = capabilities.filter(
    (entry) => entry.status === "passed",
  ).length;
  return {
    readiness: passed === capabilities.length ? "ready" : "blocked",
    score: Math.round((passed / capabilities.length) * 100),
    passed,
    required: capabilities.length,
    capabilities,
  };
}
