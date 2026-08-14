import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { resolveLeadOwner } from "./lead-governance.js";

export const CRM_LEAD_ACQUISITION_CAPABILITY_IDS = Object.freeze([
  "CRM-054",
  "CRM-056",
  "CRM-057",
  "CRM-058",
  "CRM-059",
  "CRM-063",
]);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_IMPORT_FIELDS = new Set([
  "firstName",
  "lastName",
  "email",
  "phone",
  "mobile",
  "companyName",
  "jobTitle",
  "website",
  "industry",
  "city",
  "state",
  "countryCode",
  "productInterest",
  "estimatedValue",
  "currencyCode",
  "consentEmail",
  "consentSms",
  "consentWhatsapp",
  "customData",
]);

export class CrmLeadAcquisitionError extends Error {
  constructor(
    status,
    message,
    code = "CRM_LEAD_ACQUISITION_ERROR",
    details = [],
  ) {
    super(message);
    this.name = "CrmLeadAcquisitionError";
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
export function crmLeadAcquisitionHash(value) {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}
function text(value, max = 4000) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}
function email(value) {
  return text(value, 320).toLowerCase();
}
function phone(value) {
  return text(value, 40).replace(/\D+/g, "").slice(-15);
}
function boolean(value) {
  return (
    value === true ||
    ["true", "1", "yes", "y"].includes(text(value).toLowerCase())
  );
}
function assertUuid(value, label) {
  if (!UUID.test(String(value || "")))
    throw new CrmLeadAcquisitionError(400, `${label} is invalid.`);
}
function mapped(row, mapping, name) {
  const source = mapping[name] || name;
  return row[source];
}

export function normalizeLeadFieldMapping(mapping = {}) {
  const normalized = {};
  for (const [target, source] of Object.entries(mapping || {})) {
    if (!ALLOWED_IMPORT_FIELDS.has(target))
      throw new CrmLeadAcquisitionError(
        400,
        `Unsupported lead field mapping: ${target}.`,
      );
    const sourceName = text(source, 120);
    if (!sourceName)
      throw new CrmLeadAcquisitionError(
        400,
        `Source column for ${target} is required.`,
      );
    normalized[target] = sourceName;
  }
  if (!normalized.firstName) normalized.firstName = "firstName";
  return normalized;
}

export function validateLeadImportRows(rows, mapping = {}) {
  if (!Array.isArray(rows) || rows.length === 0)
    throw new CrmLeadAcquisitionError(
      400,
      "At least one import row is required.",
    );
  if (rows.length > 5000)
    throw new CrmLeadAcquisitionError(
      413,
      "A lead import is limited to 5,000 rows.",
    );
  const normalizedMapping = normalizeLeadFieldMapping(mapping);
  return rows.map((source, index) => {
    const row = source && typeof source === "object" ? source : {};
    const normalized = {
      firstName: text(mapped(row, normalizedMapping, "firstName"), 160),
      lastName: text(mapped(row, normalizedMapping, "lastName"), 160) || null,
      email: email(mapped(row, normalizedMapping, "email")) || null,
      phone: text(mapped(row, normalizedMapping, "phone"), 40) || null,
      mobile: text(mapped(row, normalizedMapping, "mobile"), 40) || null,
      companyName:
        text(mapped(row, normalizedMapping, "companyName"), 240) || null,
      jobTitle: text(mapped(row, normalizedMapping, "jobTitle"), 160) || null,
      website: text(mapped(row, normalizedMapping, "website"), 500) || null,
      industry: text(mapped(row, normalizedMapping, "industry"), 160) || null,
      city: text(mapped(row, normalizedMapping, "city"), 160) || null,
      state: text(mapped(row, normalizedMapping, "state"), 160) || null,
      countryCode:
        text(mapped(row, normalizedMapping, "countryCode"), 2).toUpperCase() ||
        null,
      productInterest:
        text(mapped(row, normalizedMapping, "productInterest"), 500) || null,
      estimatedValue: Number(
        mapped(row, normalizedMapping, "estimatedValue") || 0,
      ),
      currencyCode:
        text(mapped(row, normalizedMapping, "currencyCode"), 3).toUpperCase() ||
        null,
      consentEmail: boolean(mapped(row, normalizedMapping, "consentEmail")),
      consentSms: boolean(mapped(row, normalizedMapping, "consentSms")),
      consentWhatsapp: boolean(
        mapped(row, normalizedMapping, "consentWhatsapp"),
      ),
      customData: mapped(row, normalizedMapping, "customData") || {},
    };
    const errors = [];
    if (!normalized.firstName)
      errors.push({ field: "firstName", message: "First name is required." });
    if (normalized.email && !/^\S+@\S+\.\S+$/.test(normalized.email))
      errors.push({ field: "email", message: "Email is invalid." });
    if (!normalized.email && !phone(normalized.mobile || normalized.phone))
      errors.push({ field: "contact", message: "Email or phone is required." });
    if (
      !Number.isFinite(normalized.estimatedValue) ||
      normalized.estimatedValue < 0
    )
      errors.push({
        field: "estimatedValue",
        message: "Estimated value must be non-negative.",
      });
    return {
      rowNumber: index + 1,
      raw: row,
      normalized,
      errors,
      valid: errors.length === 0,
    };
  });
}

export function verifyLeadAcquisitionWebhookSignature({
  rawBody,
  timestamp,
  signature,
  secret,
  now = Date.now(),
}) {
  if (!secret || !timestamp || !signature) return false;
  const seconds = Number(timestamp);
  if (
    !Number.isFinite(seconds) ||
    Math.abs(Math.floor(now / 1000) - seconds) > 300
  )
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const left = Buffer.from(expected);
  const right = Buffer.from(String(signature));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function normalizeLeadAcquisitionEvent(provider, payload = {}) {
  const source = String(provider || "custom").toLowerCase();
  const providerEventId = text(
    payload.eventId ||
      payload.event_id ||
      payload.id ||
      payload.leadgen_id ||
      payload.form_response_id,
    240,
  );
  if (!providerEventId)
    throw new CrmLeadAcquisitionError(400, "Provider event ID is required.");
  const lead =
    payload.lead && typeof payload.lead === "object" ? payload.lead : payload;
  const sourceChannel = ["google_ads", "meta", "linkedin"].includes(source)
    ? "advertising"
    : ["instagram", "facebook", "whatsapp"].includes(source)
      ? "social"
      : source === "website_chat"
        ? "chat"
        : source === "inbound_email"
          ? "email"
          : "other";
  return {
    provider: source,
    providerEventId,
    eventType: text(
      payload.eventType || payload.event_type || "lead.created",
      120,
    ),
    sourceChannel,
    lead: {
      firstName: text(
        lead.firstName || lead.first_name || lead.given_name || lead.name,
        160,
      ),
      lastName:
        text(lead.lastName || lead.last_name || lead.family_name, 160) || null,
      email: email(lead.email) || null,
      mobile: text(lead.mobile || lead.phone || lead.phone_number, 40) || null,
      companyName:
        text(lead.companyName || lead.company_name || lead.company, 240) ||
        null,
      jobTitle: text(lead.jobTitle || lead.job_title, 160) || null,
      website: text(lead.website, 500) || null,
      industry: text(lead.industry, 160) || null,
      city: text(lead.city, 160) || null,
      state: text(lead.state, 160) || null,
      countryCode: text(lead.countryCode || lead.country_code, 2).toUpperCase() || null,
      productInterest: text(lead.productInterest || lead.product_interest, 500) || null,
      estimatedValue: Number(lead.estimatedValue || lead.estimated_value || 0),
      currencyCode: text(lead.currencyCode || lead.currency_code, 3).toUpperCase() || null,
      consentEmail: boolean(lead.consentEmail || lead.consent_email),
      consentSms: boolean(lead.consentSms || lead.consent_sms),
      consentWhatsapp: boolean(lead.consentWhatsapp || lead.consent_whatsapp),
      customData: lead.customData || lead.custom_data || {},
    },
    attribution: payload.attribution || {
      campaignId: payload.campaign_id,
      adId: payload.ad_id,
      formId: payload.form_id,
    },
  };
}

export function buildLeadFormDefinition(input = {}) {
  const fields = Array.isArray(input.fields) ? input.fields : [];
  if (!fields.length)
    throw new CrmLeadAcquisitionError(
      400,
      "At least one form field is required.",
    );
  const seen = new Set();
  const normalized = fields.map((field, index) => {
    const name = text(field.name, 80);
    if (!name || seen.has(name))
      throw new CrmLeadAcquisitionError(
        400,
        "Form field names must be unique.",
      );
    seen.add(name);
    return {
      name,
      label: text(field.label || name, 120),
      type: [
        "text",
        "email",
        "phone",
        "textarea",
        "select",
        "checkbox",
        "hidden",
      ].includes(field.type)
        ? field.type
        : "text",
      required: Boolean(field.required),
      options: Array.isArray(field.options)
        ? field.options.map((option) => text(option, 120)).filter(Boolean)
        : [],
      order: index + 1,
    };
  });
  if (!normalized.some((field) => field.name === "firstName" && field.required))
    throw new CrmLeadAcquisitionError(
      400,
      "A required firstName field is mandatory.",
    );
  return {
    fields: normalized,
    layout: input.layout || { columns: 1 },
    style: input.style || {},
  };
}

export function buildEnrichmentReview(input = {}) {
  const proposed =
    input.proposedChanges && typeof input.proposedChanges === "object"
      ? input.proposedChanges
      : {};
  const confidence = Number(input.confidence ?? 0);
  if (confidence < 0 || confidence > 100)
    throw new CrmLeadAcquisitionError(
      400,
      "Confidence must be between 0 and 100.",
    );
  const allowed = new Set([
    "companyName",
    "jobTitle",
    "website",
    "industry",
    "city",
    "state",
    "countryCode",
    "customData",
  ]);
  const filtered = Object.fromEntries(
    Object.entries(proposed).filter(([key]) => allowed.has(key)),
  );
  return {
    proposedChanges: filtered,
    confidence,
    provenance: input.provenance || {},
    provider: text(input.provider || "custom", 80),
  };
}

async function findDuplicate(client, context, lead) {
  const result = await client.query(
    `SELECT id FROM tenant.crm_leads WHERE organization_id=$1 AND status<>'archived'
      AND (($2<>'' AND normalized_email=$2) OR ($3<>'' AND normalized_phone=$3))
      ORDER BY updated_at DESC LIMIT 1`,
    [
      context.organizationId,
      email(lead.email),
      phone(lead.mobile || lead.phone),
    ],
  );
  return result.rows[0]?.id || null;
}

async function createLead(client, context, lead, options = {}) {
  const duplicateId = await findDuplicate(client, context, lead);
  if (duplicateId && options.duplicateStrategy === "block")
    throw new CrmLeadAcquisitionError(409, "A matching lead already exists.", "CRM_LEAD_DUPLICATE");
  if (duplicateId && ["skip", "warn"].includes(options.duplicateStrategy))
    return { leadId: duplicateId, action: "skip" };
  if (duplicateId && options.duplicateStrategy === "update") {
    const updated = await client.query(
      `UPDATE tenant.crm_leads
          SET first_name=COALESCE(NULLIF($3,''),first_name),last_name=COALESCE($4,last_name),
              company_name=COALESCE($5,company_name),job_title=COALESCE($6,job_title),
              updated_by=$2,updated_at=now()
        WHERE organization_id=$1 AND id=$7 RETURNING id`,
      [context.organizationId,context.userId,lead.firstName,lead.lastName,lead.companyName,lead.jobTitle,duplicateId],
    );
    return { leadId: updated.rows[0].id, action: "update" };
  }
  const ownerUserId = lead.ownerUserId || options.ownerUserId ||
    (await resolveLeadOwner(client, context, {
      ...lead,
      companyId: options.companyId || context.activeCompanyId,
      branchId: options.branchId || context.activeBranchId,
      sourceId: options.sourceId || lead.sourceId || null,
      campaignId: options.campaignId || lead.campaignId || null,
    })) || context.userId;
  const inserted = await client.query(
    `INSERT INTO tenant.crm_leads(
       organization_id,company_id,branch_id,code,first_name,last_name,email,phone,mobile,
       company_name,job_title,website,industry,source_id,campaign_id,owner_user_id,
       estimated_value,currency_code,city,state,country_code,product_interest,
       consent_email,consent_sms,consent_whatsapp,custom_data,created_by,updated_by
     ) VALUES(
       $1,$2,$3,'LEAD-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
       $4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
       $22,$23,$24,$25::jsonb,$26,$26
     ) RETURNING id`,
    [context.organizationId,options.companyId||context.activeCompanyId,options.branchId||context.activeBranchId,
     lead.firstName,lead.lastName,lead.email,lead.phone,lead.mobile,lead.companyName,lead.jobTitle,
     lead.website,lead.industry,options.sourceId||lead.sourceId||null,options.campaignId||lead.campaignId||null,
     ownerUserId,Number(lead.estimatedValue||0),lead.currencyCode,lead.city,lead.state,lead.countryCode,
     lead.productInterest,Boolean(lead.consentEmail),Boolean(lead.consentSms),Boolean(lead.consentWhatsapp),
     JSON.stringify(lead.customData||{}),context.userId],
  );
  return { leadId: inserted.rows[0].id, action: "create", ownerUserId };
}

export async function previewLeadImport(client, context, input = {}) {
  const rows = validateLeadImportRows(input.rows, input.fieldMapping || {});
  const contentHash = crmLeadAcquisitionHash({
    fileName: text(input.fileName || "lead-import.csv", 240),
    sourceFormat: text(input.sourceFormat || "csv", 20),
    duplicateStrategy: text(input.duplicateStrategy || "skip", 20),
    rows: input.rows,
    fieldMapping: input.fieldMapping || {},
  });
  const existing = await client.query(
    `SELECT * FROM tenant.crm_lead_import_batches WHERE organization_id=$1 AND content_hash=$2`,
    [context.organizationId, contentHash],
  );
  if (existing.rows[0])
    return { batch: existing.rows[0], rows, idempotent: true };
  const batch = await client.query(
    `INSERT INTO tenant.crm_lead_import_batches(organization_id,company_id,branch_id,file_name,source_format,field_mapping,duplicate_strategy,total_rows,valid_rows,invalid_rows,content_hash,created_by)
     VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      context.organizationId,
      input.companyId || context.activeCompanyId,
      input.branchId || context.activeBranchId,
      text(input.fileName || "lead-import.csv", 240),
      text(input.sourceFormat || "csv", 20),
      JSON.stringify(input.fieldMapping || {}),
      text(input.duplicateStrategy || "skip", 20),
      rows.length,
      rows.filter((r) => r.valid).length,
      rows.filter((r) => !r.valid).length,
      contentHash,
      context.userId,
    ],
  );
  for (const row of rows)
    await client.query(
      `INSERT INTO tenant.crm_lead_import_rows(organization_id,batch_id,row_number,raw_data,normalized_data,validation_errors,action)
     VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7)`,
      [
        context.organizationId,
        batch.rows[0].id,
        row.rowNumber,
        JSON.stringify(row.raw),
        JSON.stringify(row.normalized),
        JSON.stringify(row.errors),
        row.valid ? "pending" : "error",
      ],
    );
  return { batch: batch.rows[0], rows, idempotent: false };
}

export async function commitLeadImport(client, context, batchId) {
  assertUuid(batchId, "Import batch");
  const batchResult = await client.query(
    `SELECT * FROM tenant.crm_lead_import_batches WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, batchId],
  );
  const batch = batchResult.rows[0];
  if (!batch) throw new CrmLeadAcquisitionError(404, "Import batch not found.");
  if (batch.status !== "previewed")
    throw new CrmLeadAcquisitionError(
      409,
      "Only a previewed import can be committed.",
    );
  await client.query(
    `UPDATE tenant.crm_lead_import_batches SET status='committing',updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, batchId],
  );
  const rows = await client.query(
    `SELECT * FROM tenant.crm_lead_import_rows WHERE organization_id=$1 AND batch_id=$2 ORDER BY row_number`,
    [context.organizationId, batchId],
  );
  let created = 0,
    updated = 0,
    skipped = 0,
    failed = 0;
  for (const row of rows.rows) {
    if (row.action === "error") {
      failed++;
      continue;
    }
    try {
      const result = await createLead(client, context, row.normalized_data, {
        duplicateStrategy: batch.duplicate_strategy,
        companyId: batch.company_id,
        branchId: batch.branch_id,
      });
      if (result.action === "create") created++;
      else if (result.action === "update") updated++;
      else skipped++;
      await client.query(
        `UPDATE tenant.crm_lead_import_rows SET action=$3,result_lead_id=$4,processed_at=now() WHERE organization_id=$1 AND id=$2`,
        [context.organizationId, row.id, result.action, result.leadId],
      );
      if (result.action === "create")
        await client.query(
          `INSERT INTO tenant.crm_lead_provenance(organization_id,lead_id,source_channel,source_record_id,provider,external_id,original_payload,content_hash,created_by)
         VALUES($1,$2,'import',$3,'import',$4,$5::jsonb,$6,$7)`,
          [
            context.organizationId,
            result.leadId,
            batchId,
            `${batchId}:${row.row_number}`,
            JSON.stringify(row.raw_data),
            crmLeadAcquisitionHash(row.raw_data),
            context.userId,
          ],
        );
    } catch (error) {
      failed++;
      await client.query(
        `UPDATE tenant.crm_lead_import_rows SET action='error',validation_errors=$3::jsonb,processed_at=now() WHERE organization_id=$1 AND id=$2`,
        [
          context.organizationId,
          row.id,
          JSON.stringify([{ message: error.message || "Import failed" }]),
        ],
      );
    }
  }
  const status = failed ? "completed_with_errors" : "completed";
  const result = await client.query(
    `UPDATE tenant.crm_lead_import_batches SET status=$3,created_rows=$4,updated_rows=$5,skipped_rows=$6,committed_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, batchId, status, created, updated, skipped],
  );
  return result.rows[0];
}

export async function rollbackLeadImport(client, context, batchId) {
  assertUuid(batchId, "Import batch");
  const batch = await client.query(
    `SELECT * FROM tenant.crm_lead_import_batches WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, batchId],
  );
  if (!batch.rows[0])
    throw new CrmLeadAcquisitionError(404, "Import batch not found.");
  if (!["completed", "completed_with_errors"].includes(batch.rows[0].status))
    throw new CrmLeadAcquisitionError(
      409,
      "Only a completed import can be rolled back.",
    );
  const deleted = await client.query(
    `DELETE FROM tenant.crm_leads lead USING tenant.crm_lead_provenance provenance
     WHERE provenance.organization_id=$1 AND provenance.source_channel='import' AND provenance.source_record_id=$2
       AND lead.organization_id=provenance.organization_id AND lead.id=provenance.lead_id
       AND NOT EXISTS(SELECT 1 FROM tenant.crm_activities activity WHERE activity.organization_id=lead.organization_id AND activity.entity_type='lead' AND activity.entity_id=lead.id)
     RETURNING lead.id`,
    [context.organizationId, batchId],
  );
  await client.query(
    `UPDATE tenant.crm_lead_import_batches SET status='rolled_back',rolled_back_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, batchId],
  );
  return {
    rolledBack: deleted.rows.length,
    protected: Math.max(
      0,
      Number(batch.rows[0].created_rows) - deleted.rows.length,
    ),
  };
}

export async function saveLeadForm(client, context, input = {}) {
  const definition = buildLeadFormDefinition(input.definition || input);
  const id = input.id || null;
  if (id) {
    assertUuid(id, "Capture form");
    const result = await client.query(
      `UPDATE tenant.crm_capture_forms SET name=$3,form_schema=$4::jsonb,landing_page=$5::jsonb,allowed_origins=$6,success_message=$7,thank_you_url=$8,consent_text=$9,duplicate_strategy=$10,captcha_mode=$11,version=version+1,status='inactive',published_at=NULL,updated_by=$2,updated_at=now()
     WHERE organization_id=$1 AND id=$12 RETURNING *`,
      [
        context.organizationId,
        context.userId,
        text(input.name, 200),
        JSON.stringify(definition),
        JSON.stringify(input.landingPage || {}),
        input.allowedOrigins || [],
        text(
          input.successMessage ||
            "Thank you. Our team will contact you shortly.",
          500,
        ),
        text(input.thankYouUrl, 1000) || null,
        text(input.consentText, 2000) || null,
        text(input.duplicateStrategy || "warn", 20),
        text(input.captchaMode || "honeypot", 20),
        id,
      ],
    );
    if (!result.rows[0])
      throw new CrmLeadAcquisitionError(404, "Capture form not found.");
    return result.rows[0];
  }
  const result = await client.query(
    `INSERT INTO tenant.crm_capture_forms(organization_id,company_id,branch_id,name,source_id,campaign_id,owner_user_id,allowed_origins,required_fields,success_message,status,created_by,updated_by,form_schema,landing_page,thank_you_url,consent_text,duplicate_strategy,captcha_mode)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'inactive',$11,$11,$12::jsonb,$13::jsonb,$14,$15,$16,$17) RETURNING *`,
    [
      context.organizationId,
      input.companyId || context.activeCompanyId,
      input.branchId || context.activeBranchId,
      text(input.name, 200),
      input.sourceId || null,
      input.campaignId || null,
      input.ownerUserId || context.userId,
      input.allowedOrigins || [],
      definition.fields.filter((f) => f.required).map((f) => f.name),
      text(
        input.successMessage || "Thank you. Our team will contact you shortly.",
        500,
      ),
      context.userId,
      JSON.stringify(definition),
      JSON.stringify(input.landingPage || {}),
      text(input.thankYouUrl, 1000) || null,
      text(input.consentText, 2000) || null,
      text(input.duplicateStrategy || "warn", 20),
      text(input.captchaMode || "honeypot", 20),
    ],
  );
  return result.rows[0];
}

export async function publishLeadForm(client, context, formId) {
  assertUuid(formId, "Capture form");
  const result = await client.query(
    `UPDATE tenant.crm_capture_forms SET status='active',published_at=now(),unpublished_at=NULL,updated_by=$2,updated_at=now() WHERE organization_id=$1 AND id=$3 RETURNING *`,
    [context.organizationId, context.userId, formId],
  );
  if (!result.rows[0])
    throw new CrmLeadAcquisitionError(404, "Capture form not found.");
  return result.rows[0];
}

export async function submitPublishedLeadForm(
  client,
  context,
  form,
  input = {},
) {
  const formId = form.id || form.form_id;
  assertUuid(formId, "Capture form");
  const fingerprint = crmLeadAcquisitionHash(
    input.__fingerprint || "anonymous",
  ).slice(0, 64);
  const limit = Number(form.rate_limit_per_hour || 60);
  const rate = await client.query(
    `INSERT INTO tenant.crm_capture_rate_limits(organization_id,form_id,fingerprint,window_started_at,attempts)
     VALUES($1,$2,$3,date_trunc('hour',now()),1)
     ON CONFLICT(organization_id,form_id,fingerprint,window_started_at)
     DO UPDATE SET attempts=tenant.crm_capture_rate_limits.attempts+1
     RETURNING attempts`,
    [context.organizationId, formId, fingerprint],
  );
  if (Number(rate.rows[0]?.attempts || 0) > limit)
    throw new CrmLeadAcquisitionError(429, "Lead-form rate limit exceeded.");
  const definition = buildLeadFormDefinition(form.form_schema || {});
  const payload = {};
  for (const field of definition.fields) {
    payload[field.name] = input[field.name];
    if (field.required && !text(input[field.name]))
      throw new CrmLeadAcquisitionError(400, `${field.label} is required.`);
  }
  const lead = {
    firstName: text(payload.firstName, 160),
    lastName: text(payload.lastName, 160) || null,
    email: email(payload.email) || null,
    mobile: text(payload.mobile || payload.phone, 40) || null,
    companyName: text(payload.companyName, 240) || null,
    jobTitle: text(payload.jobTitle, 160) || null,
    consentEmail: boolean(payload.consentEmail),
    consentSms: boolean(payload.consentSms),
    consentWhatsapp: boolean(payload.consentWhatsapp),
    customData: payload,
  };
  const result = await createLead(client, context, lead, {
    duplicateStrategy: form.duplicate_strategy || "warn",
    companyId: form.company_id,
    branchId: form.branch_id,
    sourceId: form.source_id,
    campaignId: form.campaign_id,
    ownerUserId: form.owner_user_id,
  });
  await client.query(
    `INSERT INTO tenant.crm_lead_provenance(organization_id,lead_id,source_channel,source_record_id,provider,external_id,original_payload,attribution,consent_evidence,content_hash,created_by) VALUES($1,$2,'form',$3,'capture_form',$4,$5::jsonb,$6::jsonb,$7::jsonb,$8,$9) ON CONFLICT DO NOTHING`,
    [
      context.organizationId,
      result.leadId,
      formId,
      String(Date.now()),
      JSON.stringify(input),
      JSON.stringify({
        campaignId: form.campaign_id,
        sourceId: form.source_id,
      }),
      JSON.stringify({
        consentText: form.consent_text,
        granted: Boolean(input.consent),
      }),
      crmLeadAcquisitionHash(input),
      context.userId,
    ],
  );
  return {
    ...result,
    successMessage: form.success_message,
    thankYouUrl: form.thank_you_url,
  };
}

export async function createLeadAcquisitionConnection(
  client,
  context,
  input = {},
) {
  const provider = text(input.provider, 40);
  if (
    ![
      "google_ads",
      "meta",
      "linkedin",
      "instagram",
      "facebook",
      "whatsapp",
      "website_chat",
      "inbound_email",
      "custom",
      "mock",
    ].includes(provider)
  )
    throw new CrmLeadAcquisitionError(400, "Unsupported acquisition provider.");
  const result = await client.query(
    `INSERT INTO tenant.crm_lead_acquisition_connections(organization_id,company_id,provider,display_name,credential_reference,configuration,status,created_by,updated_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$8) ON CONFLICT(organization_id,provider,display_name) DO UPDATE SET credential_reference=EXCLUDED.credential_reference,configuration=EXCLUDED.configuration,status=EXCLUDED.status,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING *`,
    [
      context.organizationId,
      input.companyId || context.activeCompanyId,
      provider,
      text(input.displayName || provider, 160),
      text(input.credentialReference, 500) || null,
      JSON.stringify({
        ...(input.configuration && typeof input.configuration === "object" ? input.configuration : {}),
        ...(input.webhookSecretReference ? { webhookSecretReference: text(input.webhookSecretReference, 500) } : {}),
        ...(input.metadata && typeof input.metadata === "object" ? { metadata: input.metadata } : {}),
      }),
      text(input.status || "sandbox", 20),
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function ingestLeadAcquisitionWebhook(
  client,
  context,
  connectionId,
  provider,
  payload = {},
) {
  assertUuid(connectionId, "Acquisition connection");
  const connectionResult = await client.query(
    `SELECT company_id,provider,configuration,status
       FROM tenant.crm_lead_acquisition_connections
      WHERE organization_id=$1 AND id=$2 AND status IN ('sandbox','connected')`,
    [context.organizationId, connectionId],
  );
  const connection = connectionResult.rows[0];
  if (!connection)
    throw new CrmLeadAcquisitionError(404, "Acquisition connection is not active.", "CRM_ACQUISITION_CONNECTION_NOT_FOUND");
  if (String(connection.provider) !== String(provider))
    throw new CrmLeadAcquisitionError(409, "Provider does not match the registered acquisition connection.", "CRM_ACQUISITION_PROVIDER_MISMATCH");
  const configuration = connection.configuration || {};
  const normalized = normalizeLeadAcquisitionEvent(provider, payload);
  const hash = crmLeadAcquisitionHash(payload);
  const inserted = await client.query(
    `INSERT INTO tenant.crm_lead_acquisition_events(organization_id,connection_id,provider,provider_event_id,event_type,source_channel,raw_payload,normalized_payload,payload_hash,status) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,'received') ON CONFLICT(organization_id,provider,provider_event_id) DO NOTHING RETURNING *`,
    [
      context.organizationId,
      connectionId,
      normalized.provider,
      normalized.providerEventId,
      normalized.eventType,
      normalized.sourceChannel,
      JSON.stringify(payload),
      JSON.stringify(normalized),
      hash,
    ],
  );
  if (!inserted.rows[0]) return { duplicate: true };
  try {
    const result = await createLead(client, context, normalized.lead, {
      duplicateStrategy: "skip",
      companyId: connection.company_id || context.activeCompanyId,
      sourceId: configuration.sourceId || configuration.source_id || null,
      campaignId: configuration.campaignId || configuration.campaign_id || null,
      ownerUserId: configuration.ownerUserId || configuration.owner_user_id || null,
    });
    await client.query(
      `UPDATE tenant.crm_lead_acquisition_events SET status='processed',lead_id=$3,processed_at=now() WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, inserted.rows[0].id, result.leadId],
    );
    await client.query(
      `INSERT INTO tenant.crm_lead_provenance(organization_id,lead_id,source_channel,source_record_id,provider,external_id,original_payload,attribution,content_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10) ON CONFLICT DO NOTHING`,
      [
        context.organizationId,
        result.leadId,
        normalized.sourceChannel,
        inserted.rows[0].id,
        normalized.provider,
        normalized.providerEventId,
        JSON.stringify(payload),
        JSON.stringify(normalized.attribution),
        hash,
        context.userId,
      ],
    );
    return { eventId: inserted.rows[0].id, ...result };
  } catch (error) {
    await client.query(
      `UPDATE tenant.crm_lead_acquisition_events SET status='failed',error_message=$3,processed_at=now() WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, inserted.rows[0].id, text(error.message, 1000)],
    );
    throw error;
  }
}

export async function startLeadChatSession(
  client,
  context,
  connectionId,
  input = {},
) {
  assertUuid(connectionId, "Chat connection");
  const visitorKey = crmLeadAcquisitionHash({
    fingerprint: input.fingerprint,
    pageUrl: input.pageUrl,
  }).slice(0, 48);
  let leadId = null;
  if (Boolean(input.consent) && (email(input.email) || phone(input.phone))) {
    const captured = await createLead(
      client,
      context,
      {
        firstName: text(input.name || "Website visitor", 160),
        email: email(input.email) || null,
        mobile: text(input.phone, 40) || null,
        consentEmail: Boolean(input.consentEmail),
        consentSms: Boolean(input.consentSms),
        consentWhatsapp: Boolean(input.consentWhatsapp),
        customData: { pageUrl: input.pageUrl, channel: "website_chat" },
      },
      { duplicateStrategy: "skip" },
    );
    leadId = captured.leadId;
  }
  const result = await client.query(
    `INSERT INTO tenant.crm_chat_sessions(organization_id,connection_id,visitor_key,visitor_name,visitor_email,visitor_phone,page_url,consent_granted,lead_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      context.organizationId,
      connectionId,
      visitorKey,
      text(input.name, 160) || null,
      email(input.email) || null,
      text(input.phone, 40) || null,
      text(input.pageUrl, 1000) || null,
      Boolean(input.consent),
      leadId,
    ],
  );
  return result.rows[0];
}
export async function appendLeadChatMessage(
  client,
  context,
  sessionId,
  input = {},
) {
  assertUuid(sessionId, "Chat session");
  const body = text(input.body, 8000);
  if (!body)
    throw new CrmLeadAcquisitionError(400, "Message body is required.");
  const result = await client.query(
    `INSERT INTO tenant.crm_chat_messages(organization_id,session_id,provider_message_id,sender_type,sender_user_id,message_type,body,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(organization_id,session_id,provider_message_id) DO NOTHING RETURNING *`,
    [
      context.organizationId,
      sessionId,
      text(input.providerMessageId, 240) || null,
      text(input.senderType || "visitor", 20),
      input.senderUserId || null,
      text(input.messageType || "text", 20),
      body,
      JSON.stringify(input.metadata || {}),
    ],
  );
  await client.query(
    `UPDATE tenant.crm_chat_sessions SET last_message_at=now() WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, sessionId],
  );
  return result.rows[0] || { duplicate: true };
}

export async function queueLeadEnrichment(client, context, input = {}) {
  assertUuid(input.entityId, "Entity");
  const review = buildEnrichmentReview(input);
  const job = await client.query(
    `INSERT INTO tenant.crm_enrichment_jobs(organization_id,company_id,entity_type,entity_id,provider,requested_fields,status,requested_by) VALUES($1,$2,$3,$4,$5,$6::jsonb,'queued',$7) RETURNING *`,
    [
      context.organizationId,
      input.companyId || context.activeCompanyId,
      text(input.entityType || "lead", 20),
      input.entityId,
      review.provider,
      JSON.stringify(
        input.requestedFields || Object.keys(review.proposedChanges),
      ),
      context.userId,
    ],
  );
  let reviewId = null;
  if (Object.keys(review.proposedChanges).length) {
    const createdReview = await client.query(
      `INSERT INTO tenant.crm_enrichment_reviews(organization_id,enrichment_job_id,proposed_changes,provenance,confidence) VALUES($1,$2,$3::jsonb,$4::jsonb,$5) RETURNING id`,
      [
        context.organizationId,
        job.rows[0].id,
        JSON.stringify(review.proposedChanges),
        JSON.stringify(review.provenance),
        review.confidence,
      ],
    );
    reviewId = createdReview.rows[0]?.id || null;
  }
  return { ...job.rows[0], reviewId };
}

export async function reviewLeadEnrichment(
  client,
  context,
  reviewId,
  input = {},
) {
  assertUuid(reviewId, "Enrichment review");
  const locked = await client.query(
    `SELECT review.*,job.entity_type,job.entity_id FROM tenant.crm_enrichment_reviews review JOIN tenant.crm_enrichment_jobs job ON job.organization_id=review.organization_id AND job.id=review.enrichment_job_id WHERE review.organization_id=$1 AND review.id=$2 FOR UPDATE`,
    [context.organizationId, reviewId],
  );
  const row = locked.rows[0];
  if (!row)
    throw new CrmLeadAcquisitionError(404, "Enrichment review not found.");
  if (row.status !== "pending")
    throw new CrmLeadAcquisitionError(
      409,
      "Enrichment review is already complete.",
    );
  const decision = text(input.decision, 20).toLowerCase();
  if (decision && !["approved", "rejected"].includes(decision)) {
    throw new CrmLeadAcquisitionError(
      400,
      "Enrichment decision must be approved or rejected.",
    );
  }
  const acceptedKeys =
    decision === "rejected"
      ? []
      : Array.isArray(input.acceptedKeys)
        ? input.acceptedKeys.map((key) => text(key, 120)).filter(Boolean)
        : decision === "approved"
          ? Object.keys(row.proposed_changes || {})
          : [];
  const accepted = Object.fromEntries(
    Object.entries(row.proposed_changes || {}).filter(([key]) =>
      acceptedKeys.includes(key),
    ),
  );
  const rejected = Object.fromEntries(
    Object.entries(row.proposed_changes || {}).filter(
      ([key]) => !acceptedKeys.includes(key),
    ),
  );
  if (row.entity_type === "lead" && Object.keys(accepted).length) {
    const columnMap = {
      companyName: "company_name",
      jobTitle: "job_title",
      website: "website",
      industry: "industry",
      city: "city",
      state: "state",
      countryCode: "country_code",
    };
    for (const [key, value] of Object.entries(accepted)) {
      if (columnMap[key])
        await client.query(
          `UPDATE tenant.crm_leads SET ${columnMap[key]}=$3,updated_by=$2,updated_at=now() WHERE organization_id=$1 AND id=$4`,
          [context.organizationId, context.userId, value, row.entity_id],
        );
      else if (key === "customData")
        await client.query(
          `UPDATE tenant.crm_leads SET custom_data=custom_data || $3::jsonb,updated_by=$2,updated_at=now() WHERE organization_id=$1 AND id=$4`,
          [
            context.organizationId,
            context.userId,
            JSON.stringify(value || {}),
            row.entity_id,
          ],
        );
    }
  }
  const status =
    Object.keys(accepted).length === 0
      ? "rejected"
      : Object.keys(rejected).length === 0
        ? "accepted"
        : "partially_accepted";
  const result = await client.query(
    `UPDATE tenant.crm_enrichment_reviews SET accepted_changes=$3::jsonb,rejected_changes=$4::jsonb,status=$5,reviewed_by=$2,reviewed_at=now() WHERE organization_id=$1 AND id=$6 RETURNING *`,
    [
      context.organizationId,
      context.userId,
      JSON.stringify(accepted),
      JSON.stringify(rejected),
      status,
      reviewId,
    ],
  );
  await client.query(
    `UPDATE tenant.crm_enrichment_jobs SET status='completed',result_data=$3::jsonb,confidence=$4,completed_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [
      context.organizationId,
      row.enrichment_job_id,
      JSON.stringify(accepted),
      row.confidence,
    ],
  );
  return result.rows[0];
}

export async function getLeadAcquisitionDashboard(client, context) {
  const summary = await client.query(
    `SELECT (SELECT count(*)::int FROM tenant.crm_lead_import_batches WHERE organization_id=$1) imports,(SELECT count(*)::int FROM tenant.crm_capture_forms WHERE organization_id=$1 AND status='active' AND published_at IS NOT NULL) published_forms,(SELECT count(*)::int FROM tenant.crm_lead_acquisition_connections WHERE organization_id=$1 AND status IN ('sandbox','connected')) active_connections,(SELECT count(*)::int FROM tenant.crm_lead_acquisition_events WHERE organization_id=$1 AND status='processed') processed_events,(SELECT count(*)::int FROM tenant.crm_chat_sessions WHERE organization_id=$1 AND status='open') open_chats,(SELECT count(*)::int FROM tenant.crm_enrichment_reviews WHERE organization_id=$1 AND status='pending') pending_enrichment`,
    [context.organizationId],
  );
  const imports = await client.query(
    `SELECT id,file_name,status,total_rows,valid_rows,invalid_rows,created_rows,created_at FROM tenant.crm_lead_import_batches WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 10`,
    [context.organizationId],
  );
  const forms = await client.query(
    `SELECT id,name,public_key,status,version,published_at FROM tenant.crm_capture_forms WHERE organization_id=$1 ORDER BY updated_at DESC LIMIT 10`,
    [context.organizationId],
  );
  const connections = await client.query(
    `SELECT id,provider,display_name,status,last_event_at,last_error FROM tenant.crm_lead_acquisition_connections WHERE organization_id=$1 ORDER BY updated_at DESC`,
    [context.organizationId],
  );
  const events = await client.query(
    `SELECT id,provider,event_type,source_channel,status,lead_id,received_at FROM tenant.crm_lead_acquisition_events WHERE organization_id=$1 ORDER BY received_at DESC LIMIT 10`,
    [context.organizationId],
  );
  const enrichment = await client.query(
    `SELECT review.id,job.provider,job.entity_type,job.entity_id,review.confidence,review.status,review.created_at FROM tenant.crm_enrichment_reviews review JOIN tenant.crm_enrichment_jobs job ON job.organization_id=review.organization_id AND job.id=review.enrichment_job_id WHERE review.organization_id=$1 ORDER BY review.created_at DESC LIMIT 10`,
    [context.organizationId],
  );
  return {
    summary: summary.rows[0] || {},
    imports: imports.rows,
    forms: forms.rows,
    connections: connections.rows,
    events: events.rows,
    enrichment: enrichment.rows,
  };
}

export async function recordCrmLeadAcquisitionAcceptance(
  client,
  context,
  input = {},
) {
  const capabilityId = text(input.capabilityId, 20);
  if (!CRM_LEAD_ACQUISITION_CAPABILITY_IDS.includes(capabilityId))
    throw new CrmLeadAcquisitionError(400, "Unsupported CRM-06 capability.");
  const evidence = input.evidence || {};
  const hash = crmLeadAcquisitionHash(evidence);
  const result = await client.query(
    `INSERT INTO tenant.crm_lead_acquisition_acceptance_runs(organization_id,capability_id,commit_sha,status,evidence,evidence_hash,provider_acceptance,recorded_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8) ON CONFLICT(organization_id,capability_id,commit_sha) DO NOTHING RETURNING *`,
    [
      context.organizationId,
      capabilityId,
      text(input.commitSha || "local", 80),
      text(input.status || "passed", 20),
      JSON.stringify(evidence),
      hash,
      text(input.providerAcceptance || "sandbox", 20),
      context.userId,
    ],
  );
  return result.rows[0] || { idempotent: true, evidenceHash: hash };
}

export async function getCrmLeadAcquisitionReadiness(client, context) {
  const dashboard = await getLeadAcquisitionDashboard(client, context);
  const evidence = await client.query(
    `SELECT capability_id,status,provider_acceptance,recorded_at FROM tenant.crm_lead_acquisition_acceptance_runs WHERE organization_id=$1 ORDER BY recorded_at DESC`,
    [context.organizationId],
  );
  const latest = new Map();
  for (const row of evidence.rows)
    if (!latest.has(row.capability_id)) latest.set(row.capability_id, row);
  const blockers = [];
  for (const id of CRM_LEAD_ACQUISITION_CAPABILITY_IDS) {
    const row = latest.get(id);
    if (!row || row.status !== "passed")
      blockers.push(`${id} lacks passing acceptance evidence.`);
  }
  const score = Math.round(
    ((CRM_LEAD_ACQUISITION_CAPABILITY_IDS.length - blockers.length) /
      CRM_LEAD_ACQUISITION_CAPABILITY_IDS.length) *
      100,
  );
  return {
    readiness: blockers.length ? "blocked" : "ready",
    score,
    blockers,
    capabilities: CRM_LEAD_ACQUISITION_CAPABILITY_IDS.map((id) => ({
      id,
      ...(latest.get(id) || { status: "missing" }),
    })),
    summary: dashboard.summary,
  };
}
