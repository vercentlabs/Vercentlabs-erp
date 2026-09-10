import { CrmError } from "../crm-data-operations-and-customization/errors.js";
import { queueOutboxEvent } from "../crm-data-operations-and-customization/outbox.js";
import { getCrmAccount } from "./account-operations.js";
import {
  normalizeContactInput,
  validateContactInput,
} from "./contact-record-validation.js";
import {
  canViewSensitiveContactContent,
  firstSensitiveContactInputField,
  projectContactForContext,
} from "./contact-security.js";
import {
  ensurePrimaryRelationshipFromLegacyFields,
  clearPrimaryRelationshipFromLegacyFields,
} from "./contact-relationships.js";
import {
  findContactDuplicates,
  recordContactDuplicateOverride,
} from "./duplicate-matching.js";
import { assertExpectedRecordVersion } from "./record-version.js";

// F008 create-time governed duplicate check (CRM-VNEXT-081), mirroring
// account-operations.js's assertAccountDuplicatePolicy and Lead's
// established exact-classification-blocks-unless-overridden contract.
async function assertContactDuplicatePolicy(client, context, candidate, overrideReason) {
  const matches = await findContactDuplicates(client, context, {
    email: candidate.email,
    mobile: candidate.mobile || candidate.phone,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
  });
  const exact = matches.filter((row) => row.classification === "exact");
  if (!exact.length) return null;
  const canOverride = Boolean(context.permissions?.includes("crm.accounts.manage"));
  const reason = String(overrideReason || "").trim();
  if (!canOverride || reason.length < 10) {
    throw new CrmError(
      409,
      canOverride
        ? "Explain in at least 10 characters why this exact duplicate must be created."
        : "This looks like an exact duplicate of an existing contact. You do not have permission to create it anyway.",
      "CRM_CONTACT_DUPLICATE_EXACT",
      { matches: exact },
    );
  }
  return { matchedContactIds: exact.map((row) => row.id), reason };
}

const ACCOUNT_TYPES = ["customer", "both", "prospect"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTACT_FIELDS = Object.freeze({
  accountId: "party_id",
  firstName: "first_name",
  lastName: "last_name",
  designation: "designation",
  email: "email",
  phone: "phone",
  mobile: "mobile",
  isPrimary: "is_primary",
  preferredLanguage: "preferred_language",
  timezone: "timezone",
});

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function camelize(value) {
  return value.replace(/_([a-z])/g, (_match, character) =>
    character.toUpperCase(),
  );
}

function contactDto(row) {
  const result = Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [camelize(key), value]),
  );
  result.accountId = result.partyId ?? null;
  delete result.partyId;
  return result;
}

function addParameter(parameters, value) {
  parameters.push(value);
  return `$${parameters.length}`;
}

function boundedInteger(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(maximum, Math.trunc(parsed)))
    : fallback;
}

function assertId(value, field = "Contact") {
  if (!UUID_PATTERN.test(String(value || ""))) {
    throw new CrmError(
      400,
      `${field} identifier is invalid.`,
      `CRM_${field.toUpperCase()}_ID_INVALID`,
    );
  }
}

function contactScope(context, parameters, contact = "contact", account = "account") {
  if (context.activeCompanyId) {
    return ` AND (${contact}.party_id IS NULL OR ${account}.company_id IS NULL OR ${account}.company_id = ${addParameter(parameters, context.activeCompanyId)})`;
  }
  return context.allowAllCompanies ? "" : " AND false";
}

function assertWritableScope(context) {
  if (!context.activeCompanyId && !context.allowAllCompanies) {
    throw new CrmError(
      403,
      "Select an allowed company before maintaining contacts.",
      "CRM_CONTACT_SCOPE_FORBIDDEN",
    );
  }
}

function assertSensitiveContactMutationAllowed(context, input) {
  if (canViewSensitiveContactContent(context)) return;
  const field = firstSensitiveContactInputField(input);
  if (!field) return;
  throw new CrmError(
    403,
    "You do not have permission to change sensitive Contact content.",
    "CRM_CONTACT_SENSITIVE_FIELD_FORBIDDEN",
    { field },
  );
}

function assertGovernedFields(input) {
  if (hasOwn(input, "ownerUserId")) {
    throw new CrmError(
      403,
      "Contact ownership is not available in the canonical Contact model.",
      "CRM_CONTACT_OWNER_FORBIDDEN",
    );
  }
  if (hasOwn(input, "companyId") || hasOwn(input, "branchId")) {
    throw new CrmError(
      403,
      "Contact scope is derived from the current workspace and linked account.",
      "CRM_CONTACT_SCOPE_FORBIDDEN",
    );
  }
}

function throwValidation(input, options) {
  const issues = validateContactInput(input, options);
  if (!issues.length) return;
  const errors = {};
  for (const item of issues) {
    errors[item.field] ||= [];
    errors[item.field].push(item.message);
  }
  throw new CrmError(400, issues[0].message, issues[0].code, { errors });
}

function persistenceError(error) {
  if (error instanceof CrmError) return error;
  if (error?.code === "23505") {
    return new CrmError(
      409,
      "A primary contact already exists for that account.",
      "CRM_CONTACT_CONFLICT",
    );
  }
  if (error?.code === "23503") {
    return new CrmError(
      400,
      "Select an available account.",
      "CRM_CONTACT_ACCOUNT_NOT_FOUND",
    );
  }
  if (error?.code === "23514" || error?.code === "22P02") {
    return new CrmError(
      400,
      "Review the contact details and try again.",
      "CRM_CONTACT_VALIDATION_ERROR",
    );
  }
  return new CrmError(
    500,
    "The contact could not be saved.",
    "CRM_CONTACT_PERSISTENCE_ERROR",
  );
}

function contactSelect() {
  return `
    SELECT contact.*,
      account.display_name AS account_name,
      account.status AS account_status,
      account.company_id AS account_company_id,
      address.city AS account_city,
      address.state AS account_state,
      address.country_code AS account_country_code
    FROM tenant.contacts contact
    LEFT JOIN tenant.business_parties account
      ON account.organization_id = contact.organization_id
     AND account.id = contact.party_id
    LEFT JOIN LATERAL (
      SELECT candidate.city, candidate.state, candidate.country_code
      FROM tenant.addresses candidate
      WHERE candidate.organization_id = account.organization_id
        AND candidate.party_id = account.id
        AND candidate.status = 'active'
      ORDER BY candidate.is_primary DESC, candidate.created_at
      LIMIT 1
    ) address ON true`;
}

async function validateAccountRelationship(client, context, accountId) {
  if (!accountId) return null;
  try {
    const account = await getCrmAccount(client, context, accountId);
    if (account.status !== "active") {
      throw new CrmError(
        409,
        "New contact links require an active account.",
        "CRM_CONTACT_ACCOUNT_ARCHIVED",
        { errors: { accountId: ["Select an active account."] } },
      );
    }
    return account;
  } catch (error) {
    if (error instanceof CrmError && error.code === "CRM_ACCOUNT_NOT_FOUND") {
      throw new CrmError(
        404,
        "Account not found.",
        "CRM_CONTACT_ACCOUNT_NOT_FOUND",
        { errors: { accountId: ["Select an available account."] } },
      );
    }
    throw error;
  }
}

export async function listCrmContacts(client, context, options = {}) {
  const limit = Math.max(1, boundedInteger(options.limit, 25, 100));
  const offset = boundedInteger(options.offset, 0, 100_000);
  const parameters = [context.organizationId, ACCOUNT_TYPES];
  let where = `
    WHERE contact.organization_id = $1
      AND (contact.party_id IS NULL OR account.party_type = ANY($2::text[]))
      ${contactScope(context, parameters)}`;

  const search = String(options.search || "").trim().slice(0, 200);
  if (search) {
    const query = addParameter(parameters, search);
    const pattern = addParameter(parameters, `%${search}%`);
    const sensitive = canViewSensitiveContactContent(context);
    where += ` AND (
      to_tsvector(
        'simple',
        coalesce(contact.first_name, '') || ' ' ||
        coalesce(contact.last_name, '') || ' ' ||
        coalesce(contact.designation, '')${
          sensitive
            ? " || ' ' || coalesce(contact.email, '') || ' ' || coalesce(contact.mobile, '') || ' ' || coalesce(contact.phone, '')"
            : ""
        }
      ) @@ plainto_tsquery('simple', ${query})
      OR concat_ws(' ', contact.first_name, contact.last_name) ILIKE ${pattern}
      ${sensitive ? `OR coalesce(contact.email, '') ILIKE ${pattern}` : ""}
      ${sensitive ? `OR coalesce(contact.mobile, '') ILIKE ${pattern}` : ""}
      ${sensitive ? `OR coalesce(contact.phone, '') ILIKE ${pattern}` : ""}
      OR coalesce(account.display_name, '') ILIKE ${pattern}
    )`;
  }

  const status = String(options.status || "active");
  if (["active", "inactive"].includes(status)) {
    where += ` AND contact.status = ${addParameter(parameters, status)}`;
  }
  const accountId = String(options.accountId || "").trim();
  if (accountId) {
    assertId(accountId, "Account");
    where += ` AND contact.party_id = ${addParameter(parameters, accountId)}`;
  }

  const count = await client.query(
    `SELECT count(*)::int AS count FROM (${contactSelect()} ${where}) scoped_contact`,
    parameters,
  );
  const listParameters = [...parameters];
  const limitParameter = addParameter(listParameters, limit);
  const offsetParameter = addParameter(listParameters, offset);
  const result = await client.query(
    `${contactSelect()} ${where}
     ORDER BY contact.updated_at DESC, contact.first_name, contact.last_name, contact.id
     LIMIT ${limitParameter} OFFSET ${offsetParameter}`,
    listParameters,
  );
  return {
    rows: result.rows.map((row) => projectContactForContext(context, contactDto(row))),
    total: Number(count.rows[0]?.count || 0),
    limit,
    offset,
  };
}

export async function getCrmContact(client, context, id) {
  assertId(id);
  const parameters = [context.organizationId, id, ACCOUNT_TYPES];
  const result = await client.query(
    `${contactSelect()}
     WHERE contact.organization_id = $1
       AND contact.id = $2
       AND (contact.party_id IS NULL OR account.party_type = ANY($3::text[]))
       ${contactScope(context, parameters)}
     LIMIT 1`,
    parameters,
  );
  if (!result.rows[0]) {
    throw new CrmError(404, "Contact not found.", "CRM_CONTACT_NOT_FOUND");
  }
  const relationships = await client.query(
    `SELECT
       (SELECT count(*)::int FROM tenant.crm_opportunities
        WHERE organization_id = $1 AND contact_id = $2 AND status <> 'archived') AS opportunities,
       (SELECT count(*)::int FROM tenant.crm_activities
        WHERE organization_id = $1 AND entity_type = 'contact' AND entity_id = $2) AS activities`,
    [context.organizationId, id],
  );
  return {
    ...contactDto(result.rows[0]),
    relationships: {
      opportunities: Number(relationships.rows[0]?.opportunities || 0),
      activities: Number(relationships.rows[0]?.activities || 0),
    },
  };
}

// getCrmContact intentionally returns unredacted data: it is reused
// internally (e.g. updateCrmContact's "existing" merge for validation, which
// needs the real email/phone/mobile to correctly evaluate "at least one
// contact method remains" even for a caller who cannot themselves set those
// fields). Callers returning a contact to the outside world must apply
// projectContactForContext themselves — see createCrmContact,
// updateCrmContact and archiveCrmContact below.
export async function getCrmContactForCaller(client, context, id) {
  return projectContactForContext(context, await getCrmContact(client, context, id));
}

async function setPrimaryState(client, context, contactId, accountId, isPrimary) {
  if (!accountId || !isPrimary) return;
  await client.query(
    `UPDATE tenant.contacts
     SET is_primary = false, updated_by = $4, updated_at = now()
     WHERE organization_id = $1 AND party_id = $2 AND id <> $3
       AND is_primary = true AND status = 'active'`,
    [context.organizationId, accountId, contactId, context.userId],
  );
}

export async function createCrmContact(client, context, input = {}) {
  try {
    assertGovernedFields(input);
    assertSensitiveContactMutationAllowed(context, input);
    assertWritableScope(context);
    if (input.status && String(input.status).trim().toLowerCase() !== "active") {
      throw new CrmError(
        400,
        "A new contact must start active.",
        "CRM_CONTACT_INITIAL_STATUS_INVALID",
      );
    }
    const normalized = normalizeContactInput({ status: "active", ...input });
    throwValidation(normalized);
    await validateAccountRelationship(client, context, normalized.accountId);
    const duplicateOverride = await assertContactDuplicatePolicy(
      client,
      context,
      normalized,
      input.duplicateOverrideReason,
    );

    let primary = false;
    if (normalized.accountId) {
      if (hasOwn(normalized, "isPrimary")) {
        primary = normalized.isPrimary;
      } else {
        const current = await client.query(
          `SELECT 1 FROM tenant.contacts
           WHERE organization_id = $1 AND party_id = $2
             AND is_primary = true AND status = 'active' LIMIT 1`,
          [context.organizationId, normalized.accountId],
        );
        primary = !current.rows[0];
      }
    }

    const result = await client.query(
      `INSERT INTO tenant.contacts (
         organization_id, party_id, first_name, last_name, designation,
         email, phone, mobile, is_primary, preferred_language, timezone,
         status, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12,$12)
       RETURNING id`,
      [
        context.organizationId,
        normalized.accountId ?? null,
        normalized.firstName,
        normalized.lastName,
        normalized.designation,
        normalized.email,
        normalized.phone,
        normalized.mobile,
        primary,
        normalized.preferredLanguage ?? null,
        normalized.timezone ?? null,
        context.userId,
      ],
    );
    await setPrimaryState(
      client,
      context,
      result.rows[0].id,
      normalized.accountId,
      primary,
    );
    if (duplicateOverride) {
      await recordContactDuplicateOverride(
        client,
        context,
        result.rows[0].id,
        duplicateOverride.matchedContactIds,
        "create",
        duplicateOverride.reason,
      );
    }
    await ensurePrimaryRelationshipFromLegacyFields(
      client,
      context,
      result.rows[0].id,
      normalized.accountId,
      primary,
    );
    await queueOutboxEvent(
      client,
      context,
      "crm.contacts.created",
      "contact",
      result.rows[0].id,
      { contactId: result.rows[0].id, accountId: normalized.accountId },
    );
    return getCrmContactForCaller(client, context, result.rows[0].id);
  } catch (error) {
    throw persistenceError(error);
  }
}

export async function updateCrmContact(
  client,
  context,
  id,
  input = {},
  expectations = {},
) {
  try {
    assertGovernedFields(input);
    assertSensitiveContactMutationAllowed(context, input);
    assertWritableScope(context);
    if (hasOwn(input, "status")) {
      throw new CrmError(
        409,
        "Use the governed archive or reactivate action to change contact status.",
        "CRM_CONTACT_STATUS_ACTION_REQUIRED",
      );
    }
    const existing = await getCrmContact(client, context, id);
    // Integrity closeout (Prompts 1-5): same gap as Accounts — this ran a
    // plain UPDATE ... WHERE id=$2 with no expected-version check at all.
    assertExpectedRecordVersion(existing, expectations.expectedUpdatedAt, {
      entityLabel: "Contact",
      codePrefix: "CRM_CONTACT",
      required: expectations.requireVersion === true,
    });
    const normalized = normalizeContactInput(input);
    throwValidation(normalized, { existing, mode: "update" });

    if (hasOwn(normalized, "accountId") && normalized.accountId) {
      await validateAccountRelationship(client, context, normalized.accountId);
    }
    const supplied = Object.keys(CONTACT_FIELDS).filter((field) =>
      hasOwn(normalized, field),
    );
    if (!supplied.length) {
      throw new CrmError(
        400,
        "Provide at least one contact field to update.",
        "CRM_CONTACT_EMPTY_PATCH",
      );
    }

    const accountChanged = hasOwn(normalized, "accountId");
    const accountId = accountChanged ? normalized.accountId : existing.accountId;
    let isPrimary = hasOwn(normalized, "isPrimary")
      ? normalized.isPrimary
      : existing.isPrimary;
    if (!accountId || (accountChanged && !hasOwn(normalized, "isPrimary"))) {
      isPrimary = false;
    }

    const parameters = [context.organizationId, id];
    const assignments = supplied
      .filter((field) => field !== "isPrimary")
      .map(
        (field) =>
          `${CONTACT_FIELDS[field]} = ${addParameter(parameters, normalized[field])}`,
      );
    if (hasOwn(normalized, "isPrimary") || accountChanged) {
      assignments.push(`is_primary = ${addParameter(parameters, isPrimary)}`);
    }
    const updatedBy = addParameter(parameters, context.userId);
    const versionGuard = expectations.expectedUpdatedAt
      ? ` AND updated_at = ${addParameter(parameters, existing.updatedAt)}`
      : "";
    const updateResult = await client.query(
      `UPDATE tenant.contacts
       SET ${assignments.join(", ")}, updated_by = ${updatedBy}, updated_at = now()
       WHERE organization_id = $1 AND id = $2${versionGuard}
       RETURNING id`,
      parameters,
    );
    if (versionGuard && updateResult.rowCount === 0) {
      throw new CrmError(
        409,
        "This Contact changed after you loaded it. Refresh and try again.",
        "CRM_STALE_WRITE",
      );
    }
    await setPrimaryState(client, context, id, accountId, isPrimary);
    if (accountChanged && !accountId) {
      await clearPrimaryRelationshipFromLegacyFields(client, context, id);
    } else if (accountChanged || hasOwn(normalized, "isPrimary")) {
      await ensurePrimaryRelationshipFromLegacyFields(client, context, id, accountId, isPrimary);
    }
    await queueOutboxEvent(
      client,
      context,
      "crm.contacts.updated",
      "contact",
      id,
      { contactId: id, changedFields: Object.keys(normalized) },
    );
    return getCrmContactForCaller(client, context, id);
  } catch (error) {
    throw persistenceError(error);
  }
}

export async function reactivateCrmContact(client, context, id, expectations = {}) {
  try {
    assertWritableScope(context);
    const existing = await getCrmContact(client, context, id);
    assertExpectedRecordVersion(existing, expectations.expectedUpdatedAt, {
      entityLabel: "Contact",
      codePrefix: "CRM_CONTACT",
      required: expectations.requireVersion === true,
    });
    if (existing.status !== "active") {
      if (existing.accountId) {
        const account = await getCrmAccount(client, context, existing.accountId);
        if (account.status !== "active") {
          throw new CrmError(
            409,
            "Reactivate the linked account before reactivating this contact.",
            "CRM_CONTACT_ACCOUNT_ARCHIVED",
            { errors: { accountId: ["The linked account is not active."] } },
          );
        }
      }
      const parameters = [context.organizationId, id, context.userId];
      const versionGuard = expectations.expectedUpdatedAt
        ? ` AND updated_at = ${addParameter(parameters, existing.updatedAt)}`
        : "";
      const reactivateResult = await client.query(
        `UPDATE tenant.contacts
         SET status = 'active', archived_at = NULL,
             updated_by = $3, updated_at = now()
         WHERE organization_id = $1 AND id = $2${versionGuard}
         RETURNING id`,
        parameters,
      );
      if (versionGuard && reactivateResult.rowCount === 0) {
        throw new CrmError(
          409,
          "This Contact changed after you loaded it. Refresh and try again.",
          "CRM_STALE_WRITE",
        );
      }
      await queueOutboxEvent(
        client,
        context,
        "crm.contacts.reactivated",
        "contact",
        id,
        { contactId: id, accountId: existing.accountId },
      );
    }
    return getCrmContactForCaller(client, context, id);
  } catch (error) {
    throw persistenceError(error);
  }
}

export async function archiveCrmContact(client, context, id, expectations = {}) {
  try {
    assertWritableScope(context);
    const existing = await getCrmContact(client, context, id);
    assertExpectedRecordVersion(existing, expectations.expectedUpdatedAt, {
      entityLabel: "Contact",
      codePrefix: "CRM_CONTACT",
      required: expectations.requireVersion === true,
    });
    if (existing.status !== "inactive") {
      const parameters = [context.organizationId, id, context.userId];
      const versionGuard = expectations.expectedUpdatedAt
        ? ` AND updated_at = ${addParameter(parameters, existing.updatedAt)}`
        : "";
      const archiveResult = await client.query(
        `UPDATE tenant.contacts
         SET status = 'inactive', archived_at = now(), is_primary = false,
             updated_by = $3, updated_at = now()
         WHERE organization_id = $1 AND id = $2${versionGuard}
         RETURNING id`,
        parameters,
      );
      if (versionGuard && archiveResult.rowCount === 0) {
        throw new CrmError(
          409,
          "This Contact changed after you loaded it. Refresh and try again.",
          "CRM_STALE_WRITE",
        );
      }
      await queueOutboxEvent(
        client,
        context,
        "crm.contacts.archived",
        "contact",
        id,
        { contactId: id, accountId: existing.accountId },
      );
    }
    return getCrmContactForCaller(client, context, id);
  } catch (error) {
    throw persistenceError(error);
  }
}
