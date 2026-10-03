// CRM privacy requests (data-subject requests): load, subject resolution,
// readiness (identity verification, status, legal hold), and the governed
// execution of access/export, correction, anonymize/erase, restriction and
// consent withdrawal with an immutable execution-run record.

import { CrmAccountIntelligenceError, assertId } from "../account-intelligence-error.js";
import { crmAccountIntelligenceHash } from "../account-intelligence-hash.js";

const text = (value) => String(value ?? "").trim();
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

async function privacyRequest(client, context, requestId, lock = false) {
  const id = assertId(requestId, "Privacy request");
  const result = await client.query(
    `SELECT * FROM tenant.crm_privacy_requests
     WHERE organization_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
    [context.organizationId, id],
  );
  if (!result.rows[0]) {
    throw new CrmAccountIntelligenceError(
      404,
      "Privacy request not found.",
      "CRM_PRIVACY_REQUEST_NOT_FOUND",
    );
  }
  return result.rows[0];
}

async function privacySubject(
  client,
  context,
  subjectType,
  subjectId,
  lock = false,
) {
  const id = assertId(subjectId, "Privacy subject");
  const config = {
    lead: { table: "crm_leads", label: "Lead" },
    contact: { table: "contacts", label: "Contact" },
    party: { table: "business_parties", label: "Account" },
  }[subjectType];
  if (!config)
    throw new CrmAccountIntelligenceError(400, "Subject type is invalid.");
  const result = await client.query(
    `SELECT * FROM tenant.${config.table}
     WHERE organization_id=$1 AND id=$2${lock ? " FOR UPDATE" : ""}`,
    [context.organizationId, id],
  );
  if (!result.rows[0]) {
    throw new CrmAccountIntelligenceError(404, `${config.label} not found.`);
  }
  return result.rows[0];
}

async function privacyCounts(client, context, subjectType, subjectId) {
  if (subjectType === "lead") {
    const result = await client.query(
      `SELECT
        (SELECT count(*)::int FROM tenant.crm_activities WHERE organization_id=$1 AND entity_type='lead' AND entity_id=$2) AS activities,
        (SELECT count(*)::int FROM tenant.crm_communications WHERE organization_id=$1 AND lead_id=$2) AS communications,
        (SELECT count(*)::int FROM tenant.crm_notes WHERE organization_id=$1 AND entity_type='lead' AND entity_id=$2) AS notes`,
      [context.organizationId, subjectId],
    );
    return result.rows[0];
  }
  if (subjectType === "contact") {
    const result = await client.query(
      `SELECT
        (SELECT count(*)::int FROM tenant.crm_activities WHERE organization_id=$1 AND entity_type='contact' AND entity_id=$2) AS activities,
        (SELECT count(*)::int FROM tenant.crm_communications WHERE organization_id=$1 AND contact_id=$2) AS communications,
        (SELECT count(*)::int FROM tenant.crm_opportunities WHERE organization_id=$1 AND contact_id=$2) AS opportunities`,
      [context.organizationId, subjectId],
    );
    return result.rows[0];
  }
  const result = await client.query(
    `SELECT
      (SELECT count(*)::int FROM tenant.contacts WHERE organization_id=$1 AND party_id=$2) AS contacts,
      (SELECT count(*)::int FROM tenant.addresses WHERE organization_id=$1 AND party_id=$2) AS addresses,
      (SELECT count(*)::int FROM tenant.crm_opportunities WHERE organization_id=$1 AND party_id=$2) AS opportunities,
      (SELECT count(*)::int FROM tenant.sales_orders WHERE organization_id=$1 AND party_id=$2) AS orders,
      (SELECT count(*)::int FROM tenant.accounting_customer_invoices WHERE organization_id=$1 AND party_id=$2) AS invoices`,
    [context.organizationId, subjectId],
  );
  return result.rows[0];
}

export async function previewPrivacyRequest(client, context, requestId) {
  const request = await privacyRequest(client, context, requestId);
  const subject = await privacySubject(
    client,
    context,
    request.subject_type,
    request.subject_id,
  );
  const counts = await privacyCounts(
    client,
    context,
    request.subject_type,
    request.subject_id,
  );
  return {
    request,
    subject,
    counts,
    ready:
      Boolean(request.identity_verified_at) &&
      !["completed", "rejected", "cancelled"].includes(request.status) &&
      !Boolean(subject.legal_hold),
    blockers: [
      ...(!request.identity_verified_at
        ? ["Identity verification is required."]
        : []),
      ...(["completed", "rejected", "cancelled"].includes(request.status)
        ? [`Request is already ${request.status}.`]
        : []),
      ...(subject.legal_hold ? ["The subject is under legal hold."] : []),
    ],
  };
}

export async function anonymizeSubject(client, context, subjectType, subjectId) {
  const suffix = subjectId.slice(0, 8);
  if (subjectType === "lead") {
    await client.query(
      `UPDATE tenant.crm_leads SET
         first_name=$1,last_name=NULL,email=NULL,phone=NULL,mobile=NULL,company_name=NULL,job_title=NULL,website=NULL,
         city=NULL,state=NULL,country_code=NULL,product_interest=NULL,consent_email=false,consent_sms=false,consent_whatsapp=false,
         do_not_contact=true,archived_at=COALESCE(archived_at,now()),privacy_status='anonymized',anonymized_at=now(),updated_by=$2,updated_at=now(),
         custom_data=jsonb_build_object('privacyAnonymized',true,'anonymizedAt',now())
       WHERE organization_id=$3 AND id=$4`,
      [
        `Anonymized ${suffix}`,
        context.userId,
        context.organizationId,
        subjectId,
      ],
    );
    await client.query(
      `UPDATE tenant.crm_communications SET subject='Redacted',body='[redacted by privacy execution]',from_address=NULL,to_addresses=ARRAY[]::text[],metadata=metadata || '{"privacyRedacted":true}'::jsonb,updated_by=$1,updated_at=now()
       WHERE organization_id=$2 AND lead_id=$3`,
      [context.userId, context.organizationId, subjectId],
    );
    await client.query(
      `UPDATE tenant.crm_notes SET body='[redacted by privacy execution]',updated_at=now()
       WHERE organization_id=$1 AND entity_type='lead' AND entity_id=$2`,
      [context.organizationId, subjectId],
    );
  } else if (subjectType === "contact") {
    await client.query(
      `UPDATE tenant.contacts SET first_name=$1,last_name=NULL,designation=NULL,email=NULL,phone=NULL,mobile=NULL,is_primary=false,status='inactive',privacy_status='anonymized',anonymized_at=now(),updated_by=$2,updated_at=now()
       WHERE organization_id=$3 AND id=$4`,
      [
        `Anonymized ${suffix}`,
        context.userId,
        context.organizationId,
        subjectId,
      ],
    );
    await client.query(
      `UPDATE tenant.crm_communications SET subject='Redacted',body='[redacted by privacy execution]',from_address=NULL,to_addresses=ARRAY[]::text[],metadata=metadata || '{"privacyRedacted":true}'::jsonb,updated_by=$1,updated_at=now()
       WHERE organization_id=$2 AND contact_id=$3`,
      [context.userId, context.organizationId, subjectId],
    );
  } else {
    await client.query(
      `UPDATE tenant.business_parties SET display_name=$1,legal_name=NULL,gstin=NULL,pan=NULL,msme_number=NULL,status='inactive',privacy_status='anonymized',anonymized_at=now(),updated_by=$2,updated_at=now()
       WHERE organization_id=$3 AND id=$4`,
      [
        `Anonymized account ${suffix}`,
        context.userId,
        context.organizationId,
        subjectId,
      ],
    );
    await client.query(
      `UPDATE tenant.addresses SET line1='[redacted]',line2=NULL,city='[redacted]',district=NULL,state='[redacted]',state_code=NULL,postal_code='000000',gstin=NULL,status='inactive',updated_by=$1,updated_at=now()
       WHERE organization_id=$2 AND party_id=$3`,
      [context.userId, context.organizationId, subjectId],
    );
    await client.query(
      `UPDATE tenant.contacts SET first_name='Anonymized',last_name=NULL,designation=NULL,email=NULL,phone=NULL,mobile=NULL,is_primary=false,status='inactive',privacy_status='anonymized',anonymized_at=now(),updated_by=$1,updated_at=now()
       WHERE organization_id=$2 AND party_id=$3`,
      [context.userId, context.organizationId, subjectId],
    );
    await client.query(
      `UPDATE tenant.crm_communications SET subject='Redacted',body='[redacted by privacy execution]',from_address=NULL,to_addresses=ARRAY[]::text[],metadata=metadata || '{"privacyRedacted":true}'::jsonb,updated_by=$1,updated_at=now()
       WHERE organization_id=$2 AND party_id=$3`,
      [context.userId, context.organizationId, subjectId],
    );
  }
}

async function eraseSubject(client, context, subjectType, subjectId) {
  await anonymizeSubject(client, context, subjectType, subjectId);
  const table =
    subjectType === "lead"
      ? "crm_leads"
      : subjectType === "contact"
        ? "contacts"
        : "business_parties";
  await client.query(
    `UPDATE tenant.${table}
     SET privacy_status='erased',updated_by=$1,updated_at=now()
     WHERE organization_id=$2 AND id=$3`,
    [context.userId, context.organizationId, subjectId],
  );
  if (subjectType === "party") {
    await client.query(
      `UPDATE tenant.contacts
       SET privacy_status='erased',updated_by=$1,updated_at=now()
       WHERE organization_id=$2 AND party_id=$3`,
      [context.userId, context.organizationId, subjectId],
    );
  }
}

export async function restrictSubject(client, context, subjectType, subjectId) {
  const table =
    subjectType === "lead"
      ? "crm_leads"
      : subjectType === "contact"
        ? "contacts"
        : "business_parties";
  await client.query(
    `UPDATE tenant.${table} SET privacy_status='restricted',updated_by=$1,updated_at=now() WHERE organization_id=$2 AND id=$3`,
    [context.userId, context.organizationId, subjectId],
  );
  if (subjectType === "lead") {
    await client.query(
      `UPDATE tenant.crm_leads SET do_not_contact=true,consent_email=false,consent_sms=false,consent_whatsapp=false WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, subjectId],
    );
  }
}

async function correctSubject(
  client,
  context,
  subjectType,
  subjectId,
  corrections,
) {
  const allowed = {
    lead: new Set([
      "firstName",
      "lastName",
      "email",
      "phone",
      "mobile",
      "companyName",
      "jobTitle",
    ]),
    contact: new Set([
      "firstName",
      "lastName",
      "email",
      "phone",
      "mobile",
      "designation",
    ]),
    party: new Set(["displayName", "legalName", "gstin", "pan"]),
  }[subjectType];
  const columns = {
    firstName: "first_name",
    lastName: "last_name",
    companyName: "company_name",
    jobTitle: "job_title",
    displayName: "display_name",
    legalName: "legal_name",
    email: "email",
    phone: "phone",
    mobile: "mobile",
    designation: "designation",
    gstin: "gstin",
    pan: "pan",
  };
  const entries = Object.entries(object(corrections)).filter(([key]) =>
    allowed.has(key),
  );
  if (!entries.length) {
    throw new CrmAccountIntelligenceError(
      400,
      "At least one supported correction is required.",
    );
  }
  const table =
    subjectType === "lead"
      ? "crm_leads"
      : subjectType === "contact"
        ? "contacts"
        : "business_parties";
  const values = [context.userId, context.organizationId, subjectId];
  const updates = entries.map(([key, value], index) => {
    values.push(value === "" ? null : value);
    return `${columns[key]}=$${index + 4}`;
  });
  await client.query(
    `UPDATE tenant.${table} SET ${updates.join(",")},updated_by=$1,updated_at=now() WHERE organization_id=$2 AND id=$3`,
    values,
  );
}

export async function executePrivacyRequest(
  client,
  context,
  requestId,
  input = {},
) {
  const preview = await previewPrivacyRequest(client, context, requestId);
  const request = await privacyRequest(client, context, requestId, true);
  const subject = await privacySubject(
    client,
    context,
    request.subject_type,
    request.subject_id,
    true,
  );
  if (!preview.ready) {
    throw new CrmAccountIntelligenceError(
      409,
      preview.blockers.join(" ") || "Privacy request is not ready.",
      "CRM_PRIVACY_EXECUTION_BLOCKED",
    );
  }
  let operation = request.request_type;
  let exportPayload = null;
  if (["access", "export"].includes(request.request_type)) {
    operation = request.request_type;
    exportPayload = {
      subject,
      counts: preview.counts,
      generatedAt: new Date().toISOString(),
    };
  } else if (request.request_type === "correction") {
    operation = "correction";
    await correctSubject(
      client,
      context,
      request.subject_type,
      request.subject_id,
      input.corrections,
    );
  } else if (request.request_type === "deletion") {
    const erasureMode = text(
      input.erasureMode || input.erasure_mode || "anonymize",
    );
    if (!new Set(["anonymize", "erase"]).has(erasureMode)) {
      throw new CrmAccountIntelligenceError(
        400,
        "Deletion mode must be anonymize or erase.",
        "CRM_PRIVACY_ERASURE_MODE_INVALID",
      );
    }
    operation = erasureMode;
    if (erasureMode === "erase") {
      await eraseSubject(
        client,
        context,
        request.subject_type,
        request.subject_id,
      );
    } else {
      await anonymizeSubject(
        client,
        context,
        request.subject_type,
        request.subject_id,
      );
    }
  } else {
    operation =
      request.request_type === "consent_withdrawal"
        ? "consent_withdrawal"
        : "restrict";
    await restrictSubject(
      client,
      context,
      request.subject_type,
      request.subject_id,
    );
  }
  const resultSummary = {
    requestType: request.request_type,
    subjectType: request.subject_type,
    subjectId: request.subject_id,
    counts: preview.counts,
    operation,
    exported: Boolean(exportPayload),
  };
  const hash = crmAccountIntelligenceHash({ resultSummary, exportPayload });
  const run = await client.query(
    `INSERT INTO tenant.crm_privacy_execution_runs(
       organization_id,privacy_request_id,subject_type,subject_id,operation,status,result_summary,content_hash,executed_by
     ) VALUES($1,$2,$3,$4,$5,'completed',$6::jsonb,$7,$8) RETURNING *`,
    [
      context.organizationId,
      request.id,
      request.subject_type,
      request.subject_id,
      operation,
      JSON.stringify(resultSummary),
      hash,
      context.userId,
    ],
  );
  await client.query(
    `UPDATE tenant.crm_privacy_requests
     SET status='completed',resolution_notes=$1,completed_at=now(),updated_by=$2,updated_at=now()
     WHERE organization_id=$3 AND id=$4`,
    [
      text(input.resolutionNotes || input.resolution_notes) ||
        `Executed ${operation} through governed CRM privacy workflow.`,
      context.userId,
      context.organizationId,
      request.id,
    ],
  );
  return { run: run.rows[0], exportPayload };
}
