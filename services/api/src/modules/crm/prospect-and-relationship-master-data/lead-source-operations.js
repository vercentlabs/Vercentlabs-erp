import { CrmError } from "../crm-data-operations-and-customization/errors.js";
import { queueOutboxEvent } from "../crm-data-operations-and-customization/outbox.js";
import {
  assertLeadSourceId,
  normalizeLeadSourceInput,
} from "./lead-source-validation.js";
import { assertExpectedRecordVersion } from "./record-version.js";

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const FIELDS = Object.freeze({
  name: "name",
  description: "description",
  channel: "channel",
  sortOrder: "sort_order",
  isDefault: "is_default",
});

const camelize = (value) =>
  value.replace(/_([a-z])/g, (_match, c) => c.toUpperCase());
const dto = (row) =>
  Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [camelize(key), value]),
  );
const add = (parameters, value) => {
  parameters.push(value);
  return `$${parameters.length}`;
};
const bounded = (value, fallback, maximum) => {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(maximum, Math.trunc(parsed)))
    : fallback;
};

function persistenceError(error) {
  if (error?.status && error?.code)
    return error instanceof CrmError
      ? error
      : new CrmError(error.status, error.message, error.code, error.details);
  if (
    error?.code === "23505" &&
    String(error?.constraint || "").includes("active_default")
  )
    return new CrmError(
      409,
      "Another active lead source is already the default.",
      "CRM_LEAD_SOURCE_DEFAULT_CONFLICT",
    );
  if (error?.code === "23505")
    return new CrmError(
      409,
      "A lead source with that name already exists.",
      "CRM_LEAD_SOURCE_DUPLICATE",
      {
        errors: { name: ["Use a unique source name."] },
      },
    );
  if (["23514", "22P02"].includes(error?.code))
    return new CrmError(
      400,
      "Review the lead source details and try again.",
      "CRM_LEAD_SOURCE_VALIDATION_ERROR",
    );
  return new CrmError(
    500,
    "The lead source could not be saved.",
    "CRM_LEAD_SOURCE_PERSISTENCE_ERROR",
  );
}

function sourceSelect() {
  return `SELECT source.*,
    (SELECT count(*)::int FROM tenant.crm_leads lead
      WHERE lead.organization_id=source.organization_id AND lead.source_id=source.id) AS lead_count
    FROM tenant.crm_lead_sources source`;
}

export async function listCrmLeadSources(client, context, options = {}) {
  const limit = Math.max(1, bounded(options.limit, 25, 100));
  const offset = bounded(options.offset, 0, 100000);
  const parameters = [context.organizationId];
  let where = "WHERE source.organization_id=$1";
  const status = String(options.status || "active");
  if (["active", "inactive"].includes(status))
    where += ` AND source.status=${add(parameters, status)}`;
  const search = String(options.search || "")
    .trim()
    .slice(0, 200);
  if (search)
    where += ` AND (source.name ILIKE ${add(parameters, `%${search}%`)} OR coalesce(source.description,'') ILIKE ${add(parameters, `%${search}%`)})`;
  const count = await client.query(
    `SELECT count(*)::int AS count FROM tenant.crm_lead_sources source ${where}`,
    parameters,
  );
  const listParameters = [...parameters];
  const result = await client.query(
    `${sourceSelect()} ${where}
     ORDER BY source.status='active' DESC, source.sort_order, source.name, source.id
     LIMIT ${add(listParameters, limit)} OFFSET ${add(listParameters, offset)}`,
    listParameters,
  );
  return {
    rows: result.rows.map(dto),
    total: Number(count.rows[0]?.count || 0),
    limit,
    offset,
  };
}

export async function getCrmLeadSource(client, context, id) {
  assertLeadSourceId(id);
  const result = await client.query(
    `${sourceSelect()} WHERE source.organization_id=$1 AND source.id=$2 LIMIT 1`,
    [context.organizationId, id],
  );
  if (!result.rows[0])
    throw new CrmError(
      404,
      "Lead source not found.",
      "CRM_LEAD_SOURCE_NOT_FOUND",
    );
  return dto(result.rows[0]);
}

async function uniqueCode(client, context, name) {
  const root =
    String(name)
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .toUpperCase()
      .slice(0, 50) || "SOURCE";
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const code = suffix ? `${root.slice(0, 44)}_${suffix + 1}` : root;
    const found = await client.query(
      `SELECT 1 FROM tenant.crm_lead_sources WHERE organization_id=$1 AND code=$2 LIMIT 1`,
      [context.organizationId, code],
    );
    if (!found.rows[0]) return code;
  }
  throw new CrmError(
    409,
    "A stable source code could not be allocated.",
    "CRM_LEAD_SOURCE_CODE_CONFLICT",
  );
}

async function clearOtherDefaults(client, context, id) {
  await client.query(
    `UPDATE tenant.crm_lead_sources SET is_default=false,updated_by=$3,updated_at=now()
     WHERE organization_id=$1 AND id<>$2 AND is_default=true`,
    [context.organizationId, id, context.userId],
  );
}

async function clearDefaults(client, context) {
  await client.query(
    `UPDATE tenant.crm_lead_sources SET is_default=false,updated_by=$2,updated_at=now()
     WHERE organization_id=$1 AND is_default=true`,
    [context.organizationId, context.userId],
  );
}

export async function createCrmLeadSource(client, context, input = {}) {
  try {
    if (
      hasOwn(input, "code") ||
      hasOwn(input, "status") ||
      hasOwn(input, "isSystem")
    )
      throw new CrmError(
        400,
        "Lead source lifecycle and internal code are governed by the system.",
        "CRM_LEAD_SOURCE_GOVERNED_FIELD",
      );
    const value = normalizeLeadSourceInput(input, { create: true });
    const code = await uniqueCode(client, context, value.name);
    if (value.isDefault) await clearDefaults(client, context);
    const result = await client.query(
      `INSERT INTO tenant.crm_lead_sources(
        organization_id,name,code,description,channel,sort_order,is_default,status,is_system,created_by,updated_by
       ) VALUES($1,$2,$3,$4,$5,$6,$7,'active',false,$8,$8) RETURNING id`,
      [
        context.organizationId,
        value.name,
        code,
        value.description ?? null,
        value.channel || "other",
        value.sortOrder ?? 100,
        value.isDefault ?? false,
        context.userId,
      ],
    );
    const created = await getCrmLeadSource(client, context, result.rows[0].id);
    await queueOutboxEvent(
      client,
      context,
      "crm.lead_sources.created",
      "lead_source",
      created.id,
      {
        sourceId: created.id,
        code: created.code,
        name: created.name,
        status: created.status,
      },
    );
    return created;
  } catch (error) {
    throw persistenceError(error);
  }
}

export async function updateCrmLeadSource(client, context, id, input = {}, expectations = {}) {
  try {
    const before = await getCrmLeadSource(client, context, id);
    if (
      ["code", "status", "isSystem", "archivedAt"].some((field) =>
        hasOwn(input, field),
      )
    )
      throw new CrmError(
        409,
        "Use the governed lifecycle action; internal source codes cannot be changed.",
        "CRM_LEAD_SOURCE_GOVERNED_FIELD",
      );
    // Concurrency (Prompts 1-5 integrity closeout): mutable Lead Source
    // fields (name/description/channel/sort order/default flag) previously
    // had no stale-write protection at all — two administrators editing the
    // same source concurrently would silently overwrite each other, unlike
    // every other governed CRM mutation. Reuses the shared checked-write
    // contract (assertExpectedRecordVersion + a WHERE ... AND updated_at=$N
    // guard) rather than a bespoke implementation.
    assertExpectedRecordVersion(before, expectations.expectedUpdatedAt, {
      entityLabel: "Lead source",
      codePrefix: "CRM_LEAD_SOURCE",
      required: expectations.requireVersion === true,
    });
    const value = normalizeLeadSourceInput(input);
    const fields = Object.keys(FIELDS).filter((field) => hasOwn(value, field));
    if (!fields.length)
      throw new CrmError(
        400,
        "Provide at least one lead source field to update.",
        "CRM_LEAD_SOURCE_EMPTY_PATCH",
      );
    if (value.isDefault) await clearOtherDefaults(client, context, id);
    const parameters = [context.organizationId, id];
    const assignments = fields.map(
      (field) => `${FIELDS[field]}=${add(parameters, value[field])}`,
    );
    assignments.push(
      `updated_by=${add(parameters, context.userId)}`,
      "updated_at=now()",
    );
    // F004: crm_lead_sources.updated_at is timestamptz with genuine
    // microsecond precision, but `expectations.expectedUpdatedAt` only ever
    // carries millisecond precision (it round-tripped through a JS Date via
    // JSON), so an exact `=` comparison here failed on every single edit —
    // this bug was never caught because there was no frontend Edit action
    // calling this function until this pass; a real browser check surfaced
    // it as an immediate CRM_STALE_WRITE on the very first save attempt.
    // Compares at millisecond precision on both sides, the same fix already
    // applied to leads/opportunities/generic-versioned-resources in
    // resource-mutation-service.js.
    const versionChecked = expectations.expectedUpdatedAt
      ? ` AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${add(parameters, new Date(expectations.expectedUpdatedAt))}::timestamptz)`
      : "";
    const write = await client.query(
      `UPDATE tenant.crm_lead_sources SET ${assignments.join(",")}
       WHERE organization_id=$1 AND id=$2${versionChecked} RETURNING id`,
      parameters,
    );
    if (versionChecked && !write.rows[0]) {
      throw new CrmError(
        409,
        "This Lead source changed after you loaded it. Refresh and try again.",
        "CRM_STALE_WRITE",
      );
    }
    const updated = await getCrmLeadSource(client, context, id);
    await queueOutboxEvent(
      client,
      context,
      "crm.lead_sources.updated",
      "lead_source",
      id,
      {
        sourceId: id,
        changedFields: fields,
        before: { name: before.name },
        after: { name: updated.name },
      },
    );
    return updated;
  } catch (error) {
    throw persistenceError(error);
  }
}

export async function setCrmLeadSourceActive(client, context, id, active, expectations = {}) {
  try {
    const before = await getCrmLeadSource(client, context, id);
    assertExpectedRecordVersion(before, expectations.expectedUpdatedAt, {
      entityLabel: "Lead source",
      codePrefix: "CRM_LEAD_SOURCE",
      required: expectations.requireVersion === true,
    });
    const status = active ? "active" : "inactive";
    if (before.status !== status) {
      const parameters = [
        context.organizationId,
        id,
        status,
        active ? null : new Date(),
        context.userId,
      ];
      // F004: same millisecond-precision fix as updateCrmLeadSource above.
      // This activate/deactivate action already shipped and its own route
      // (apps/web/src/app/api/crm/lead-sources/[id]/active/route.ts) also
      // sets requireVersion:true, so this exact-equality bug meant every
      // single Activate/Deactivate click in production has been throwing
      // CRM_STALE_WRITE unconditionally — confirmed directly against a real
      // Postgres row (a stored updated_at of ...206119, i.e. microsecond
      // precision) while verifying the Edit dialog this same pass added.
      const versionChecked = expectations.expectedUpdatedAt
        ? ` AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', ${add(parameters, new Date(expectations.expectedUpdatedAt))}::timestamptz)`
        : "";
      const write = await client.query(
        `UPDATE tenant.crm_lead_sources
         SET status=$3,archived_at=$4,is_default=CASE WHEN $3='inactive' THEN false ELSE is_default END,
             updated_by=$5,updated_at=now()
         WHERE organization_id=$1 AND id=$2${versionChecked} RETURNING id`,
        parameters,
      );
      if (versionChecked && !write.rows[0]) {
        throw new CrmError(
          409,
          "This Lead source changed after you loaded it. Refresh and try again.",
          "CRM_STALE_WRITE",
        );
      }
      await queueOutboxEvent(
        client,
        context,
        active
          ? "crm.lead_sources.reactivated"
          : "crm.lead_sources.deactivated",
        "lead_source",
        id,
        {
          sourceId: id,
          code: before.code,
          name: before.name,
          leadCount: before.leadCount,
        },
      );
    }
    return getCrmLeadSource(client, context, id);
  } catch (error) {
    throw persistenceError(error);
  }
}
