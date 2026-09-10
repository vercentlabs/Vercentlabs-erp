import { CrmError, queueOutboxEvent } from "./index.js";
import {
  normalizeAccountInput,
  validateAccountInput,
} from "./features/accounts/record-validation.js";
import {
  firstSensitiveAccountInputField,
  canViewSensitiveAccountContent,
  projectAccountForContext,
} from "./prospect-and-relationship-master-data/account-security.js";
import {
  findAccountDuplicates,
  recordAccountDuplicateOverride,
} from "./prospect-and-relationship-master-data/duplicate-matching.js";
import { assertExpectedRecordVersion } from "./prospect-and-relationship-master-data/record-version.js";

// F008 create-time governed duplicate check (CRM-VNEXT-081). Mirrors Lead's
// established exact-classification-blocks-unless-overridden contract
// (lead-duplicates.js's assertLeadDuplicatePolicy), reusing the same
// crm.accounts.manage permission the pre-existing merge/duplicates routes
// already require for any duplicate-management action.
async function assertAccountDuplicatePolicy(client, context, candidate, overrideReason) {
  const matches = await findAccountDuplicates(client, context, {
    name: candidate.displayName || candidate.legalName,
    gstin: candidate.gstin,
    pan: candidate.pan,
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
        : "This looks like an exact duplicate of an existing account. You do not have permission to create it anyway.",
      "CRM_ACCOUNT_DUPLICATE_EXACT",
      { matches: exact },
    );
  }
  return { matchedPartyIds: exact.map((row) => row.id), reason };
}

const ACCOUNT_TYPES = ["customer", "both", "prospect"];
const PARTY_FIELDS = Object.freeze({
  companyId: "company_id",
  partyType: "party_type",
  displayName: "display_name",
  legalName: "legal_name",
  industry: "industry",
  website: "website",
  phone: "phone",
  email: "email",
  gstin: "gstin",
  pan: "pan",
  msmeNumber: "msme_number",
  currencyCode: "currency_code",
});
const ADDRESS_FIELDS = Object.freeze({
  addressLine1: "line1",
  addressLine2: "line2",
  city: "city",
  state: "state",
  postalCode: "postal_code",
  countryCode: "country_code",
});

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function camelize(value) {
  return value.replace(/_([a-z])/g, (_match, character) =>
    character.toUpperCase(),
  );
}

function camelizeRow(row) {
  return Object.fromEntries(
    Object.entries(row || {}).map(([key, value]) => [camelize(key), value]),
  );
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

function accountScope(context, parameters, alias = "account") {
  if (context.activeCompanyId) {
    return ` AND (${alias}.company_id IS NULL OR ${alias}.company_id = ${addParameter(parameters, context.activeCompanyId)})`;
  }
  return context.allowAllCompanies ? "" : " AND false";
}

function assertWritableScope(context, companyId) {
  if (!context.activeCompanyId && !context.allowAllCompanies) {
    throw new CrmError(
      403,
      "Select an allowed company before maintaining accounts.",
      "CRM_ACCOUNT_SCOPE_FORBIDDEN",
    );
  }
  if (
    context.activeCompanyId &&
    companyId &&
    companyId !== context.activeCompanyId
  ) {
    throw new CrmError(
      403,
      "The account belongs to another company scope.",
      "CRM_ACCOUNT_SCOPE_FORBIDDEN",
    );
  }
}

function assertSensitiveAccountMutationAllowed(context, input) {
  if (canViewSensitiveAccountContent(context)) return;
  const field = firstSensitiveAccountInputField(input);
  if (!field) return;
  throw new CrmError(
    403,
    "You do not have permission to change sensitive Account content.",
    "CRM_ACCOUNT_SENSITIVE_FIELD_FORBIDDEN",
    { field },
  );
}

function throwValidation(input, options) {
  const issues = validateAccountInput(input, options);
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
      "An account already uses that unique identifier.",
      "CRM_ACCOUNT_CONFLICT",
    );
  }
  if (error?.code === "23503" || error?.code === "23514") {
    return new CrmError(
      400,
      "Review the account scope and submitted values.",
      "CRM_ACCOUNT_VALIDATION_ERROR",
    );
  }
  return new CrmError(
    500,
    "The account could not be saved.",
    "CRM_ACCOUNT_PERSISTENCE_ERROR",
  );
}

async function nextAccountCode(client, organizationId) {
  const result = await client.query(
    `UPDATE public.numbering_series
     SET next_number = next_number + 1
     WHERE organization_id = $1 AND entity_type = 'business_party'
     RETURNING prefix, next_number - 1 AS number, padding`,
    [organizationId],
  );
  if (!result.rows[0]) {
    throw new CrmError(
      409,
      "Account numbering is not configured for this organisation.",
      "CRM_ACCOUNT_NUMBERING_UNAVAILABLE",
    );
  }
  const row = result.rows[0];
  return `${row.prefix}${String(row.number).padStart(Number(row.padding || 5), "0")}`;
}

function accountSelect() {
  return `
    SELECT account.*,
      address.id AS address_id,
      address.line1 AS address_line1,
      address.line2 AS address_line2,
      address.city,
      address.state,
      address.postal_code,
      address.country_code,
      company.name AS company_scope_name
    FROM tenant.business_parties account
    LEFT JOIN public.companies company
      ON company.organization_id = account.organization_id
     AND company.id = account.company_id
    LEFT JOIN LATERAL (
      SELECT candidate.*
      FROM tenant.addresses candidate
      WHERE candidate.organization_id = account.organization_id
        AND candidate.party_id = account.id
        AND candidate.status = 'active'
      ORDER BY candidate.is_primary DESC, candidate.created_at
      LIMIT 1
    ) address ON true`;
}

export async function listCrmAccounts(client, context, options = {}) {
  const limit = Math.max(1, boundedInteger(options.limit, 25, 100));
  const offset = boundedInteger(options.offset, 0, 100_000);
  const parameters = [context.organizationId];
  let where = `
    WHERE account.organization_id = $1
      AND account.party_type = ANY(${addParameter(parameters, ACCOUNT_TYPES)}::text[])
      ${accountScope(context, parameters)}`;

  const search = String(options.search || "")
    .trim()
    .slice(0, 200);
  if (search) {
    const query = addParameter(parameters, search);
    const pattern = addParameter(parameters, `%${search}%`);
    where += ` AND (
      to_tsvector(
        'simple',
        coalesce(account.code, '') || ' ' ||
        coalesce(account.display_name, '') || ' ' ||
        coalesce(account.legal_name, '') || ' ' ||
        coalesce(account.industry, '') || ' ' ||
        coalesce(account.website, '') || ' ' ||
        coalesce(account.phone, '') || ' ' ||
        coalesce(account.email, '')
      ) @@ plainto_tsquery('simple', ${query})
      OR COALESCE(account.phone, '') ILIKE ${pattern}
      OR COALESCE(account.email, '') ILIKE ${pattern}
      OR EXISTS (
        SELECT 1 FROM tenant.addresses search_address
        WHERE search_address.organization_id = account.organization_id
          AND search_address.party_id = account.id
          AND search_address.status = 'active'
          AND concat_ws(' ', search_address.city, search_address.state,
            search_address.country_code, search_address.postal_code) ILIKE ${pattern}
      )
    )`;
  }

  const status = String(options.status || "active");
  if (["active", "inactive"].includes(status)) {
    where += ` AND account.status = ${addParameter(parameters, status)}`;
  }
  const industry = String(options.industry || "")
    .trim()
    .slice(0, 160);
  if (industry) {
    where += ` AND account.industry = ${addParameter(parameters, industry)}`;
  }
  const country = String(options.country || "")
    .trim()
    .toUpperCase()
    .slice(0, 2);
  if (country) {
    where += ` AND EXISTS (
      SELECT 1 FROM tenant.addresses country_address
      WHERE country_address.organization_id = account.organization_id
        AND country_address.party_id = account.id
        AND country_address.status = 'active'
        AND country_address.country_code = ${addParameter(parameters, country)}
    )`;
  }

  const count = await client.query(
    `SELECT count(*)::int AS count FROM tenant.business_parties account ${where}`,
    parameters,
  );
  const listParameters = [...parameters];
  const limitParameter = addParameter(listParameters, limit);
  const offsetParameter = addParameter(listParameters, offset);
  const result = await client.query(
    `${accountSelect()} ${where}
     ORDER BY account.updated_at DESC, account.display_name, account.id
     LIMIT ${limitParameter} OFFSET ${offsetParameter}`,
    listParameters,
  );
  const filters = await client.query(
    `SELECT
       array_remove(array_agg(DISTINCT industry ORDER BY industry), NULL) AS industries,
       array_remove(array_agg(DISTINCT address.country_code ORDER BY address.country_code), NULL) AS countries
     FROM tenant.business_parties account
     LEFT JOIN tenant.addresses address
       ON address.organization_id = account.organization_id
      AND address.party_id = account.id
      AND address.status = 'active'
     WHERE account.organization_id = $1
       AND account.party_type = ANY($2::text[])
       ${accountScope(context, [context.organizationId, ACCOUNT_TYPES])}`,
    context.activeCompanyId
      ? [context.organizationId, ACCOUNT_TYPES, context.activeCompanyId]
      : [context.organizationId, ACCOUNT_TYPES],
  );

  return {
    rows: result.rows.map((row) => projectAccountForContext(context, camelizeRow(row))),
    total: Number(count.rows[0]?.count || 0),
    limit,
    offset,
    filters: {
      industries: filters.rows[0]?.industries || [],
      countries: filters.rows[0]?.countries || [],
    },
  };
}

export async function getCrmAccount(client, context, id) {
  const parameters = [context.organizationId, id, ACCOUNT_TYPES];
  const result = await client.query(
    `${accountSelect()}
     WHERE account.organization_id = $1
       AND account.id = $2
       AND account.party_type = ANY($3::text[])
       ${accountScope(context, parameters)}
     LIMIT 1`,
    parameters,
  );
  if (!result.rows[0]) {
    throw new CrmError(404, "Account not found.", "CRM_ACCOUNT_NOT_FOUND");
  }
  const relationshipCounts = await client.query(
    `SELECT
       (SELECT count(*)::int FROM tenant.contacts
        WHERE organization_id = $1 AND party_id = $2 AND status = 'active') AS contacts,
       (SELECT count(*)::int FROM tenant.crm_opportunities
        WHERE organization_id = $1 AND party_id = $2 AND status <> 'archived') AS opportunities`,
    [context.organizationId, id],
  );
  return {
    ...camelizeRow(result.rows[0]),
    relationships: {
      contacts: Number(relationshipCounts.rows[0]?.contacts || 0),
      opportunities: Number(relationshipCounts.rows[0]?.opportunities || 0),
    },
  };
}

// The caller-safe read path — applies the sensitive-field projection.
// getCrmAccount() itself stays raw/unprojected because internal callers
// (updateCrmAccount's "existing" snapshot, audit before/after capture,
// merge preview) need the real values server-side; only responses that
// actually leave the server through an API route should call this.
export async function getCrmAccountForCaller(client, context, id) {
  return projectAccountForContext(context, await getCrmAccount(client, context, id));
}

async function upsertPrimaryAddress(client, context, accountId, input) {
  const supplied = Object.keys(ADDRESS_FIELDS).some((field) =>
    hasOwn(input, field),
  );
  if (!supplied) return;
  const existing = await client.query(
    `SELECT * FROM tenant.addresses
     WHERE organization_id = $1 AND party_id = $2 AND status = 'active'
     ORDER BY is_primary DESC, created_at
     LIMIT 1 FOR UPDATE`,
    [context.organizationId, accountId],
  );
  const current = camelizeRow(existing.rows[0] || {});
  const values = {
    addressLine1: input.addressLine1 ?? current.line1 ?? null,
    addressLine2: input.addressLine2 ?? current.line2 ?? null,
    city: input.city ?? current.city ?? null,
    state: input.state ?? current.state ?? null,
    postalCode: input.postalCode ?? current.postalCode ?? null,
    countryCode: input.countryCode ?? current.countryCode ?? null,
  };
  if (!values.addressLine1) {
    if (existing.rows[0]) {
      await client.query(
        `UPDATE tenant.addresses
         SET status = 'inactive', is_primary = false, updated_by = $3, updated_at = now()
         WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, existing.rows[0].id, context.userId],
      );
    }
    return;
  }
  for (const [field, label] of [
    ["city", "City"],
    ["state", "State"],
    ["postalCode", "Postal code"],
    ["countryCode", "Country"],
  ]) {
    if (!values[field]) {
      throw new CrmError(
        400,
        `${label} is required when a business address is provided.`,
        "CRM_ACCOUNT_ADDRESS_INCOMPLETE",
        { errors: { [field]: [`${label} is required.`] } },
      );
    }
  }
  if (existing.rows[0]) {
    await client.query(
      `UPDATE tenant.addresses SET
         line1 = $3, line2 = $4, city = $5, state = $6,
         postal_code = $7, country_code = $8,
         is_primary = true, updated_by = $9, updated_at = now()
       WHERE organization_id = $1 AND id = $2`,
      [
        context.organizationId,
        existing.rows[0].id,
        values.addressLine1,
        values.addressLine2,
        values.city,
        values.state,
        values.postalCode,
        values.countryCode,
        context.userId,
      ],
    );
  } else {
    await client.query(
      `INSERT INTO tenant.addresses (
         organization_id, party_id, address_type, line1, line2, city, state,
         postal_code, country_code, is_primary, created_by, updated_by
       ) VALUES ($1, $2, 'office', $3, $4, $5, $6, $7, $8, true, $9, $9)`,
      [
        context.organizationId,
        accountId,
        values.addressLine1,
        values.addressLine2,
        values.city,
        values.state,
        values.postalCode,
        values.countryCode,
        context.userId,
      ],
    );
  }
}

export async function createCrmAccount(client, context, input = {}) {
  try {
    if (hasOwn(input, "ownerUserId")) {
      throw new CrmError(
        403,
        "Account ownership is not available in the canonical Account model.",
        "CRM_ACCOUNT_OWNER_FORBIDDEN",
      );
    }
    if (
      input.status &&
      String(input.status).trim().toLowerCase() !== "active"
    ) {
      throw new CrmError(
        400,
        "A new account must start active.",
        "CRM_ACCOUNT_INITIAL_STATUS_INVALID",
      );
    }
    assertSensitiveAccountMutationAllowed(context, input);
    const normalized = normalizeAccountInput({
      partyType: "prospect",
      status: "active",
      ...input,
    });
    normalized.companyId =
      normalized.companyId ?? context.activeCompanyId ?? null;
    assertWritableScope(context, normalized.companyId);
    throwValidation(normalized);
    const duplicateOverride = await assertAccountDuplicatePolicy(
      client,
      context,
      normalized,
      input.duplicateOverrideReason,
    );
    const code = await nextAccountCode(client, context.organizationId);
    const result = await client.query(
      `INSERT INTO tenant.business_parties (
         organization_id, company_id, code, party_type, display_name,
         legal_name, industry, website, phone, email, gstin, pan, msme_number,
         currency_code, status, created_by, updated_by
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'active', $15, $15
       ) RETURNING *`,
      [
        context.organizationId,
        normalized.companyId,
        code,
        normalized.partyType,
        normalized.displayName,
        normalized.legalName,
        normalized.industry,
        normalized.website,
        normalized.phone,
        normalized.email,
        normalized.gstin,
        normalized.pan,
        normalized.msmeNumber ?? null,
        normalized.currencyCode,
        context.userId,
      ],
    );
    await upsertPrimaryAddress(client, context, result.rows[0].id, normalized);
    if (duplicateOverride) {
      await recordAccountDuplicateOverride(
        client,
        context,
        result.rows[0].id,
        duplicateOverride.matchedPartyIds,
        "create",
        duplicateOverride.reason,
      );
    }
    await queueOutboxEvent(
      client,
      context,
      "crm.accounts.created",
      "account",
      result.rows[0].id,
      { accountId: result.rows[0].id, companyId: normalized.companyId },
    );
    return getCrmAccountForCaller(client, context, result.rows[0].id);
  } catch (error) {
    throw persistenceError(error);
  }
}

export async function updateCrmAccount(
  client,
  context,
  id,
  input = {},
  expectations = {},
) {
  try {
    if (hasOwn(input, "ownerUserId")) {
      throw new CrmError(
        403,
        "Account ownership is not available in the canonical Account model.",
        "CRM_ACCOUNT_OWNER_FORBIDDEN",
      );
    }
    if (hasOwn(input, "status")) {
      throw new CrmError(
        409,
        "Use the governed archive action to change account lifecycle status.",
        "CRM_ACCOUNT_STATUS_ACTION_REQUIRED",
      );
    }
    assertSensitiveAccountMutationAllowed(context, input);
    const existing = await getCrmAccount(client, context, id);
    // Integrity closeout (Prompts 1-5): this previously ran a plain
    // UPDATE ... WHERE id=$2 with no expected-version check at all — two
    // concurrent editors could silently overwrite each other. Mirrors
    // Lead's exact contract (assertLeadExpectedVersion / CRM_STALE_WRITE).
    assertExpectedRecordVersion(existing, expectations.expectedUpdatedAt, {
      entityLabel: "Account",
      codePrefix: "CRM_ACCOUNT",
      required: expectations.requireVersion === true,
    });
    const normalized = normalizeAccountInput(input);
    const companyId = hasOwn(normalized, "companyId")
      ? normalized.companyId
      : existing.companyId;
    assertWritableScope(context, companyId);
    throwValidation(normalized, { existing, mode: "update" });

    const suppliedPartyFields = Object.keys(PARTY_FIELDS).filter((field) =>
      hasOwn(normalized, field),
    );
    if (
      !suppliedPartyFields.length &&
      !Object.keys(ADDRESS_FIELDS).some((field) => hasOwn(normalized, field))
    ) {
      throw new CrmError(
        400,
        "Provide at least one account field to update.",
        "CRM_ACCOUNT_EMPTY_PATCH",
      );
    }
    if (suppliedPartyFields.length) {
      const parameters = [context.organizationId, id];
      const assignments = suppliedPartyFields.map(
        (field) =>
          `${PARTY_FIELDS[field]} = ${addParameter(parameters, normalized[field])}`,
      );
      const updatedBy = addParameter(parameters, context.userId);
      // Checked-write: when a version was supplied, the WHERE clause itself
      // requires updated_at to still match what assertExpectedRecordVersion
      // just confirmed — closing the read-then-write race window without a
      // separate row lock. A zero-row result here means a concurrent writer
      // won that race (existence was already confirmed by getCrmAccount).
      const versionGuard = expectations.expectedUpdatedAt
        ? ` AND account.updated_at = ${addParameter(parameters, existing.updatedAt)}`
        : "";
      const updateResult = await client.query(
        `UPDATE tenant.business_parties account
         SET ${assignments.join(", ")}, updated_by = ${updatedBy},
             updated_at = now(),
             archived_at = CASE WHEN status = 'inactive' THEN COALESCE(archived_at, now()) ELSE NULL END
         WHERE account.organization_id = $1 AND account.id = $2${versionGuard}
         RETURNING account.id`,
        parameters,
      );
      if (versionGuard && updateResult.rowCount === 0) {
        throw new CrmError(
          409,
          "This Account changed after you loaded it. Refresh and try again.",
          "CRM_STALE_WRITE",
        );
      }
    }
    await upsertPrimaryAddress(client, context, id, normalized);
    await queueOutboxEvent(
      client,
      context,
      "crm.accounts.updated",
      "account",
      id,
      { accountId: id, changedFields: Object.keys(normalized) },
    );
    return getCrmAccountForCaller(client, context, id);
  } catch (error) {
    throw persistenceError(error);
  }
}

export async function archiveCrmAccount(client, context, id, expectations = {}) {
  try {
    const existing = await getCrmAccount(client, context, id);
    assertExpectedRecordVersion(existing, expectations.expectedUpdatedAt, {
      entityLabel: "Account",
      codePrefix: "CRM_ACCOUNT",
      required: expectations.requireVersion === true,
    });
    if (existing.status !== "inactive") {
      const parameters = [context.organizationId, id, context.userId];
      const versionGuard = expectations.expectedUpdatedAt
        ? ` AND updated_at = ${addParameter(parameters, existing.updatedAt)}`
        : "";
      const archiveResult = await client.query(
        `UPDATE tenant.business_parties
         SET status = 'inactive', archived_at = now(), updated_by = $3, updated_at = now()
         WHERE organization_id = $1 AND id = $2${versionGuard}
         RETURNING id`,
        parameters,
      );
      if (versionGuard && archiveResult.rowCount === 0) {
        throw new CrmError(
          409,
          "This Account changed after you loaded it. Refresh and try again.",
          "CRM_STALE_WRITE",
        );
      }
      await queueOutboxEvent(
        client,
        context,
        "crm.accounts.archived",
        "account",
        id,
        { accountId: id },
      );
    }
    return getCrmAccountForCaller(client, context, id);
  } catch (error) {
    throw persistenceError(error);
  }
}
