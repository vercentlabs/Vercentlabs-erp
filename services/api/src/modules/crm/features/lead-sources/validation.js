const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const LEAD_SOURCE_CHANNELS = Object.freeze([
  "website",
  "referral",
  "partner",
  "event",
  "advertising",
  "social",
  "email",
  "phone",
  "walk_in",
  "import",
  "other",
]);

export class LeadSourceError extends Error {
  constructor(status, message, code = "CRM_LEAD_SOURCE_INVALID", details) {
    super(message);
    this.name = "LeadSourceError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const trimmed = (value) => String(value ?? "").trim();

export function assertLeadSourceId(value) {
  if (!UUID_PATTERN.test(String(value || ""))) {
    throw new LeadSourceError(
      400,
      "Lead source identifier is invalid.",
      "CRM_LEAD_SOURCE_ID_INVALID",
    );
  }
}

export function normalizeLeadSourceInput(input = {}, options = {}) {
  const output = {};
  if (hasOwn(input, "name")) output.name = trimmed(input.name);
  if (hasOwn(input, "description")) {
    output.description = trimmed(input.description) || null;
  }
  if (hasOwn(input, "channel"))
    output.channel = trimmed(input.channel).toLowerCase();
  if (hasOwn(input, "sortOrder")) output.sortOrder = Number(input.sortOrder);
  if (hasOwn(input, "isDefault")) output.isDefault = Boolean(input.isDefault);

  const errors = {};
  if (options.create || hasOwn(output, "name")) {
    if (!output.name) errors.name = ["Enter a source name."];
    else if (output.name.length > 120)
      errors.name = ["Source name must be 120 characters or fewer."];
  }
  if (output.description && output.description.length > 500)
    errors.description = ["Description must be 500 characters or fewer."];
  if (
    hasOwn(output, "channel") &&
    !LEAD_SOURCE_CHANNELS.includes(output.channel)
  )
    errors.channel = ["Select an available source channel."];
  if (
    hasOwn(output, "sortOrder") &&
    (!Number.isInteger(output.sortOrder) ||
      output.sortOrder < 0 ||
      output.sortOrder > 10000)
  )
    errors.sortOrder = [
      "Display order must be a whole number from 0 to 10000.",
    ];
  if (Object.keys(errors).length) {
    const first = Object.values(errors)[0][0];
    throw new LeadSourceError(400, first, "CRM_LEAD_SOURCE_VALIDATION_ERROR", {
      errors,
    });
  }
  return output;
}

export async function validateLeadSourceAssignment(
  client,
  context,
  sourceId,
  options = {},
) {
  if (sourceId === null || sourceId === undefined || sourceId === "")
    return null;
  assertLeadSourceId(sourceId);
  const result = await client.query(
    `SELECT id,name,status FROM tenant.crm_lead_sources
     WHERE organization_id=$1 AND id=$2 LIMIT 1`,
    [context.organizationId, sourceId],
  );
  const source = result.rows[0];
  if (!source) {
    throw new LeadSourceError(
      404,
      "Lead source not found.",
      "CRM_LEAD_SOURCE_NOT_FOUND",
      { errors: { sourceId: ["Select an available lead source."] } },
    );
  }
  const unchanged =
    options.allowUnchangedInactive &&
    String(options.currentSourceId || "") === String(source.id);
  if (source.status !== "active" && !unchanged) {
    throw new LeadSourceError(
      409,
      "Inactive lead sources cannot be assigned.",
      "CRM_LEAD_SOURCE_INACTIVE",
      { errors: { sourceId: ["Select an active lead source."] } },
    );
  }
  return source;
}

export async function resolveIngestionLeadSource(client, context, requestedId) {
  if (requestedId && UUID_PATTERN.test(String(requestedId))) {
    const configured = await client.query(
      `SELECT id FROM tenant.crm_lead_sources
       WHERE organization_id=$1 AND id=$2 AND status='active' LIMIT 1`,
      [context.organizationId, requestedId],
    );
    if (configured.rows[0]) return configured.rows[0].id;
  }
  const fallback = await client.query(
    `SELECT id FROM tenant.crm_lead_sources
     WHERE organization_id=$1 AND status='active'
     ORDER BY is_default DESC, (code='WEBSITE') DESC, sort_order, name, id
     LIMIT 1`,
    [context.organizationId],
  );
  return fallback.rows[0]?.id || null;
}
