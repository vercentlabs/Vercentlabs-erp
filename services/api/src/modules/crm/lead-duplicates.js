const DUPLICATE_FIELDS = Object.freeze([
  "firstName",
  "lastName",
  "email",
  "mobile",
  "phone",
  "companyName",
]);

export const LEAD_DUPLICATE_FIELDS = DUPLICATE_FIELDS;

export class LeadDuplicateError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.name = "LeadDuplicateError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function canViewAll(context) {
  return (
    Boolean(context.roleSlugs?.includes("organization_owner")) ||
    Boolean(context.permissions?.includes("crm.records.view_all"))
  );
}

export function canOverrideLeadDuplicate(context) {
  return (
    Boolean(context.roleSlugs?.includes("organization_owner")) ||
    Boolean(context.permissions?.includes("crm.data-quality.manage"))
  );
}

function canDisclose(context, row) {
  if (context.activeCompanyId) {
    if (row.company_id && row.company_id !== context.activeCompanyId)
      return false;
  } else if (!context.allowAllCompanies) return false;

  if (context.activeBranchId) {
    if (row.branch_id && row.branch_id !== context.activeBranchId) return false;
  } else if (!context.allowAllCompanies) return false;

  return canViewAll(context) || !row.owner_user_id || row.owner_user_id === context.userId;
}

function safeMatch(context, match) {
  if (!canDisclose(context, match.row)) {
    return {
      restricted: true,
      classification: match.classification,
      signals: match.signals,
    };
  }
  return {
    id: match.row.id,
    code: match.row.code,
    name: match.row.full_name,
    company: match.row.company_name || null,
    recordStatus: match.row.record_status,
    lifecycleStage: match.row.status,
    classification: match.classification,
    signals: match.signals,
  };
}

async function normalizeInput(client, input) {
  const result = await client.query(
    `SELECT tenant.crm_normalize_email($1) AS email,
            tenant.crm_normalize_phone($2) AS mobile,
            tenant.crm_normalize_phone($3) AS business_phone,
            tenant.crm_normalize_comparison_text(
              btrim(COALESCE($4,'') || ' ' || COALESCE($5,''))
            ) AS name,
            tenant.crm_normalize_comparison_text($6) AS company`,
    [
      input.email || null,
      input.mobile || null,
      input.phone || null,
      input.firstName || null,
      input.lastName || null,
      input.companyName || null,
    ],
  );
  return result.rows[0];
}

async function lockStrongIdentityKeys(client, organizationId, normalized) {
  const keys = [];
  if (normalized.email) keys.push(`email:${normalized.email}`);
  if (normalized.mobile) keys.push(`mobile:${normalized.mobile}`);
  if (normalized.business_phone && normalized.name && normalized.company)
    keys.push(
      `business:${normalized.business_phone}:${normalized.name}:${normalized.company}`,
    );
  keys.sort();
  for (const key of keys) {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`crm-lead-duplicate:${organizationId}:${key}`],
    );
  }
}

function classify(row, normalized) {
  const signals = [];
  if (normalized.email && row.normalized_email === normalized.email)
    signals.push("email");
  if (normalized.mobile && row.normalized_mobile === normalized.mobile)
    signals.push("mobile");
  const sameBusinessPhone =
    normalized.business_phone &&
    row.normalized_business_phone === normalized.business_phone;
  const sameName = normalized.name && row.normalized_name === normalized.name;
  const sameCompany =
    normalized.company && row.normalized_company_name === normalized.company;
  if (sameBusinessPhone) signals.push("business_phone");
  if (sameName) signals.push("name");
  if (sameCompany) signals.push("company");

  const exact =
    signals.includes("email") ||
    signals.includes("mobile") ||
    (sameBusinessPhone && sameName && sameCompany);
  const probable =
    (sameName && sameCompany) ||
    (sameBusinessPhone && sameName) ||
    (sameBusinessPhone && sameCompany);
  return exact ? { classification: "exact", signals } : probable ? { classification: "probable", signals } : null;
}

export async function evaluateLeadDuplicateRisk(
  client,
  context,
  input,
  options = {},
) {
  const normalized = await normalizeInput(client, input || {});
  if (options.lock) {
    await lockStrongIdentityKeys(client, context.organizationId, normalized);
  }
  if (
    !normalized.email &&
    !normalized.mobile &&
    !normalized.business_phone &&
    !(normalized.name && normalized.company)
  ) {
    return {
      classification: "none",
      matches: [],
      internalMatches: [],
      canOverride: canOverrideLeadDuplicate(context),
    };
  }

  const result = await client.query(
    `SELECT id,code,full_name,company_name,status,record_status,
            company_id,branch_id,owner_user_id,
            normalized_email,normalized_mobile,normalized_business_phone,
            normalized_name,normalized_company_name
       FROM tenant.crm_leads
      WHERE organization_id=$1
        AND ($2::uuid IS NULL OR id<>$2)
        AND (
          ($3::text IS NOT NULL AND normalized_email=$3) OR
          ($4::text IS NOT NULL AND normalized_mobile=$4) OR
          ($5::text IS NOT NULL AND normalized_business_phone=$5) OR
          ($6::text IS NOT NULL AND $7::text IS NOT NULL
             AND normalized_name=$6 AND normalized_company_name=$7)
        )
      ORDER BY updated_at DESC,id
      LIMIT 50`,
    [
      context.organizationId,
      options.excludeLeadId || null,
      normalized.email,
      normalized.mobile,
      normalized.business_phone,
      normalized.name,
      normalized.company,
    ],
  );
  const internalMatches = result.rows
    .map((row) => {
      const risk = classify(row, normalized);
      return risk ? { ...risk, row } : null;
    })
    .filter(Boolean)
    .sort((left, right) =>
      left.classification === right.classification
        ? right.signals.length - left.signals.length
        : left.classification === "exact"
          ? -1
          : 1,
    );
  const classification = internalMatches.some(
    (match) => match.classification === "exact",
  )
    ? "exact"
    : internalMatches.length
      ? "probable"
      : "none";
  return {
    classification,
    matches: internalMatches.map((match) => safeMatch(context, match)),
    internalMatches,
    canOverride: canOverrideLeadDuplicate(context),
  };
}

function publicResult(evaluation) {
  return {
    classification: evaluation.classification,
    matches: evaluation.matches,
    canOverride: evaluation.canOverride,
  };
}

export async function assertLeadDuplicatePolicy(
  client,
  context,
  input,
  options = {},
) {
  const evaluation = await evaluateLeadDuplicateRisk(client, context, input, {
    excludeLeadId: options.excludeLeadId,
    lock: options.lock !== false,
  });
  if (evaluation.classification !== "exact") return evaluation;

  const reason = String(options.overrideReason || "").trim();
  if (!reason) {
    throw new LeadDuplicateError(
      409,
      "A matching Lead already exists.",
      "CRM_LEAD_DUPLICATE_EXACT",
      publicResult(evaluation),
    );
  }
  if (!canOverrideLeadDuplicate(context)) {
    throw new LeadDuplicateError(
      403,
      "You do not have permission to override an exact Lead duplicate.",
      "CRM_LEAD_DUPLICATE_OVERRIDE_FORBIDDEN",
      publicResult(evaluation),
    );
  }
  if (reason.length < 10 || reason.length > 1000) {
    throw new LeadDuplicateError(
      400,
      "Enter an override reason between 10 and 1,000 characters.",
      "CRM_LEAD_DUPLICATE_OVERRIDE_REASON_REQUIRED",
      publicResult(evaluation),
    );
  }
  return { ...evaluation, overrideReason: reason };
}

export async function recordLeadDuplicateOverride(
  client,
  context,
  leadId,
  evaluation,
  operation,
) {
  if (!evaluation?.overrideReason) return null;
  const matchedLeadIds = [
    ...new Set(evaluation.internalMatches.map((match) => match.row.id)),
  ];
  const result = await client.query(
    `INSERT INTO tenant.crm_lead_duplicate_overrides(
       organization_id,lead_id,matched_lead_ids,reason,actor_user_id,operation
     ) VALUES($1,$2,$3::uuid[],$4,$5,$6) RETURNING *`,
    [
      context.organizationId,
      leadId,
      matchedLeadIds,
      evaluation.overrideReason,
      context.userId,
      operation,
    ],
  );
  return result.rows[0];
}

export function hasLeadDuplicateIdentityChange(input) {
  return DUPLICATE_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(input || {}, field),
  );
}
