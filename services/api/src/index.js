import { BUSINESS_DATA_RESOURCE_KEYS } from "@vercentlabs/shared-types";

const resourceSet = new Set(BUSINESS_DATA_RESOURCE_KEYS);

export class BusinessDataError extends Error {
  constructor(status, message, code = "BUSINESS_DATA_ERROR") {
    super(message);
    this.name = "BusinessDataError";
    this.status = status;
    this.code = code;
  }
}

const resources = Object.freeze({
  parties: {
    table: "tenant.business_parties",
    searchColumns: ["code", "display_name", "legal_name", "gstin", "pan"],
    orderBy: "display_name ASC, code ASC",
    fields: {
      companyId: "company_id",
      code: "code",
      partyType: "party_type",
      displayName: "display_name",
      legalName: "legal_name",
      gstin: "gstin",
      pan: "pan",
      msmeNumber: "msme_number",
      currencyCode: "currency_code",
      creditLimit: "credit_limit",
      paymentTermId: "payment_term_id",
      status: "status",
    },
    scope: "company-nullable",
    companyField: "companyId",
    archiveStatus: "inactive",
  },
  contacts: {
    table: "tenant.contacts",
    searchColumns: [
      "first_name",
      "last_name",
      "designation",
      "email",
      "phone",
      "mobile",
    ],
    orderBy: "is_primary DESC, first_name ASC, last_name ASC",
    fields: {
      partyId: "party_id",
      firstName: "first_name",
      lastName: "last_name",
      designation: "designation",
      email: "email",
      phone: "phone",
      mobile: "mobile",
      isPrimary: "is_primary",
      status: "status",
    },
    scope: "party-company",
    relationField: "partyId",
    archiveStatus: "inactive",
  },
  addresses: {
    table: "tenant.addresses",
    searchColumns: [
      "line1",
      "line2",
      "city",
      "district",
      "state",
      "postal_code",
      "gstin",
    ],
    orderBy: "is_primary DESC, address_type ASC, city ASC",
    fields: {
      partyId: "party_id",
      addressType: "address_type",
      line1: "line1",
      line2: "line2",
      city: "city",
      district: "district",
      state: "state",
      stateCode: "state_code",
      postalCode: "postal_code",
      countryCode: "country_code",
      gstin: "gstin",
      isPrimary: "is_primary",
      status: "status",
    },
    scope: "party-company",
    relationField: "partyId",
    archiveStatus: "inactive",
  },
  "units-of-measure": {
    table: "tenant.units_of_measure",
    searchColumns: ["code", "name", "category"],
    orderBy: "category ASC, name ASC",
    fields: {
      code: "code",
      name: "name",
      category: "category",
      decimalPlaces: "decimal_places",
      isBase: "is_base",
      status: "status",
    },
    scope: "organization",
    archiveStatus: "inactive",
  },
  "item-groups": {
    table: "tenant.item_groups",
    searchColumns: ["code", "name", "description"],
    orderBy: "name ASC, code ASC",
    fields: {
      parentId: "parent_id",
      code: "code",
      name: "name",
      description: "description",
      status: "status",
    },
    scope: "organization",
    archiveStatus: "inactive",
  },
  items: {
    table: "tenant.items",
    searchColumns: ["code", "name", "description", "hsn_sac_code", "barcode"],
    orderBy: "name ASC, code ASC",
    fields: {
      companyId: "company_id",
      code: "code",
      name: "name",
      description: "description",
      itemType: "item_type",
      groupId: "group_id",
      uomId: "uom_id",
      hsnSacCode: "hsn_sac_code",
      barcode: "barcode",
      trackInventory: "track_inventory",
      allowNegativeStock: "allow_negative_stock",
      valuationMethod: "valuation_method",
      standardCost: "standard_cost",
      salesPrice: "sales_price",
      purchasePrice: "purchase_price",
      taxCategoryId: "tax_category_id",
      status: "status",
    },
    scope: "company-nullable",
    companyField: "companyId",
    archiveStatus: "inactive",
  },
  "tax-categories": {
    table: "tenant.tax_categories",
    searchColumns: ["code", "name", "description"],
    orderBy: "name ASC, code ASC",
    fields: {
      code: "code",
      name: "name",
      description: "description",
      status: "status",
    },
    scope: "organization",
    archiveStatus: "inactive",
  },
  "tax-rates": {
    table: "tenant.tax_rates",
    searchColumns: ["code", "name", "tax_type"],
    orderBy: "effective_from DESC NULLS LAST, rate ASC, name ASC",
    fields: {
      companyId: "company_id",
      taxCategoryId: "tax_category_id",
      name: "name",
      code: "code",
      taxType: "tax_type",
      rate: "rate",
      effectiveFrom: "effective_from",
      effectiveTo: "effective_to",
      status: "status",
    },
    scope: "company-nullable",
    companyField: "companyId",
    archiveStatus: "inactive",
  },
  warehouses: {
    table: "tenant.warehouses",
    searchColumns: ["code", "name", "warehouse_type"],
    orderBy: "name ASC, code ASC",
    fields: {
      companyId: "company_id",
      branchId: "branch_id",
      name: "name",
      code: "code",
      warehouseType: "warehouse_type",
      allowNegativeStock: "allow_negative_stock",
      status: "status",
    },
    scope: "company-required",
    companyField: "companyId",
    branchField: "branchId",
    archiveStatus: "inactive",
  },
  "warehouse-locations": {
    table: "tenant.warehouse_locations",
    searchColumns: ["code", "name", "location_type"],
    orderBy: "warehouse_id ASC, parent_location_id NULLS FIRST, name ASC",
    fields: {
      warehouseId: "warehouse_id",
      parentLocationId: "parent_location_id",
      name: "name",
      code: "code",
      locationType: "location_type",
      capacity: "capacity",
      status: "status",
    },
    scope: "warehouse-company",
    relationField: "warehouseId",
    archiveStatus: "inactive",
  },
  "payment-terms": {
    table: "tenant.payment_terms",
    searchColumns: ["code", "name", "description"],
    orderBy: "default_due_days ASC, name ASC",
    fields: {
      code: "code",
      name: "name",
      description: "description",
      defaultDueDays: "default_due_days",
      status: "status",
    },
    scope: "organization",
    archiveStatus: "inactive",
  },
  "price-lists": {
    table: "tenant.price_lists",
    searchColumns: ["code", "name", "price_list_type", "currency_code"],
    orderBy: "price_list_type ASC, name ASC",
    fields: {
      code: "code",
      name: "name",
      priceListType: "price_list_type",
      currencyCode: "currency_code",
      taxInclusive: "tax_inclusive",
      validFrom: "valid_from",
      validTo: "valid_to",
      status: "status",
    },
    scope: "organization",
    archiveStatus: "inactive",
  },
  "fiscal-periods": {
    table: "tenant.fiscal_periods",
    searchColumns: ["name", "fiscal_year", "status"],
    orderBy: "start_date DESC, company_id ASC",
    fields: {
      companyId: "company_id",
      name: "name",
      fiscalYear: "fiscal_year",
      startDate: "start_date",
      endDate: "end_date",
      status: "status",
    },
    scope: "company-required",
    companyField: "companyId",
    archiveStatus: "locked",
  },
  currencies: {
    table: "tenant.currencies",
    searchColumns: ["code", "name", "symbol"],
    orderBy: "is_base DESC, code ASC",
    fields: {
      code: "code",
      name: "name",
      symbol: "symbol",
      decimalPlaces: "decimal_places",
      isBase: "is_base",
      status: "status",
    },
    scope: "organization",
    archiveStatus: "inactive",
  },
  "exchange-rates": {
    table: "tenant.exchange_rates",
    searchColumns: ["from_currency_code", "to_currency_code", "source"],
    orderBy: "rate_date DESC, from_currency_code ASC, to_currency_code ASC",
    fields: {
      companyId: "company_id",
      fromCurrencyCode: "from_currency_code",
      toCurrencyCode: "to_currency_code",
      rateDate: "rate_date",
      rate: "rate",
      source: "source",
      status: "status",
    },
    scope: "company-nullable",
    companyField: "companyId",
    archiveStatus: "inactive",
  },
});

function definitionFor(resource) {
  const definition = resources[resource];
  if (!definition) {
    throw new BusinessDataError(404, "Unknown business-data resource.");
  }
  return definition;
}

export function isBusinessDataResource(value) {
  return resourceSet.has(value);
}

function camelizeKey(value) {
  return value.replace(/_([a-z])/g, (_match, character) =>
    character.toUpperCase(),
  );
}

function camelizeRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [camelizeKey(key), value]),
  );
}

function numericLimit(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(maximum, Math.trunc(parsed)));
}

function addParameter(parameters, value) {
  parameters.push(value);
  return `$${parameters.length}`;
}

function buildScopeClause(definition, context, parameters, alias = "t") {
  if (context.allowAllCompanies || definition.scope === "organization") {
    return "";
  }

  if (!context.activeCompanyId) {
    return " AND false";
  }

  if (
    (definition.branchField || definition.scope === "warehouse-company") &&
    !context.activeBranchId
  ) {
    return " AND false";
  }

  const companyParameter = addParameter(parameters, context.activeCompanyId);

  switch (definition.scope) {
    case "company-nullable":
      return ` AND (${alias}.company_id IS NULL OR ${alias}.company_id = ${companyParameter})`;
    case "company-required": {
      const branchClause = definition.branchField
        ? ` AND (${alias}.branch_id IS NULL OR ${alias}.branch_id = ${addParameter(parameters, context.activeBranchId)})`
        : "";
      return ` AND ${alias}.company_id = ${companyParameter}${branchClause}`;
    }
    case "party-company":
      return ` AND EXISTS (
        SELECT 1
        FROM tenant.business_parties scoped_party
        WHERE scoped_party.id = ${alias}.party_id
          AND scoped_party.organization_id = ${alias}.organization_id
          AND (
            scoped_party.company_id IS NULL
            OR scoped_party.company_id = ${companyParameter}
          )
      )`;
    case "warehouse-company": {
      const branchClause = ` AND (
            scoped_warehouse.branch_id IS NULL
            OR scoped_warehouse.branch_id = ${addParameter(
              parameters,
              context.activeBranchId,
            )}
          )`;
      return ` AND EXISTS (
        SELECT 1
        FROM tenant.warehouses scoped_warehouse
        WHERE scoped_warehouse.id = ${alias}.warehouse_id
          AND scoped_warehouse.organization_id = ${alias}.organization_id
          AND scoped_warehouse.company_id = ${companyParameter}
          ${branchClause}
      )`;
    }
    default:
      return "";
  }
}

function buildSearchClause(definition, search, parameters, alias = "t") {
  const normalized = String(search || "")
    .trim()
    .slice(0, 160);
  if (!normalized) return "";

  const parameter = addParameter(parameters, `%${normalized}%`);
  const clauses = definition.searchColumns.map(
    (column) => `COALESCE(${alias}.${column}::text, '') ILIKE ${parameter}`,
  );
  return ` AND (${clauses.join(" OR ")})`;
}

function buildStatusClause(status, parameters, alias = "t") {
  const normalized = String(status || "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized === "all") return "";
  const parameter = addParameter(parameters, normalized);
  return ` AND ${alias}.status = ${parameter}`;
}

function databaseError(error) {
  if (error instanceof BusinessDataError) return error;
  if (error && typeof error === "object") {
    if (error.code === "23505") {
      return new BusinessDataError(
        409,
        "A record with the same unique business key already exists.",
        "DUPLICATE_RECORD",
      );
    }
    if (error.code === "23503") {
      return new BusinessDataError(
        409,
        "This record references missing or protected master data.",
        "INVALID_REFERENCE",
      );
    }
    if (error.code === "23514" || error.code === "22P02") {
      return new BusinessDataError(
        400,
        "The submitted values do not satisfy the business-data rules.",
        "INVALID_DATA",
      );
    }
  }
  return error;
}

async function assertRelationScope(client, context, definition, input) {
  if (context.allowAllCompanies || definition.scope === "organization") {
    return input;
  }

  if (!context.activeCompanyId) {
    throw new BusinessDataError(
      403,
      "Select an allowed company before maintaining this resource.",
    );
  }

  const scopedInput = { ...input };

  if (
    (definition.branchField || definition.scope === "warehouse-company") &&
    !context.activeBranchId
  ) {
    throw new BusinessDataError(
      403,
      "Select an allowed branch before maintaining this resource.",
    );
  }
  if (definition.companyField) {
    const value = scopedInput[definition.companyField];
    if (value === null || value === undefined || value === "") {
      scopedInput[definition.companyField] = context.activeCompanyId;
    } else if (String(value) !== context.activeCompanyId) {
      throw new BusinessDataError(
        403,
        "The record is outside the active company context.",
      );
    }
  }

  if (definition.branchField) {
    const value = scopedInput[definition.branchField];
    if (value === null || value === undefined || value === "") {
      scopedInput[definition.branchField] = context.activeBranchId;
    } else if (String(value) !== context.activeBranchId) {
      throw new BusinessDataError(
        403,
        "The record is outside the active branch context.",
      );
    }
  }

  if (definition.scope === "party-company") {
    const result = await client.query(
      `
        SELECT id
        FROM tenant.business_parties
        WHERE organization_id = $1
          AND id = $2
          AND (company_id IS NULL OR company_id = $3)
      `,
      [
        context.organizationId,
        scopedInput[definition.relationField],
        context.activeCompanyId,
      ],
    );
    if (!result.rows[0]) {
      throw new BusinessDataError(
        403,
        "The selected business partner is outside the active company context.",
      );
    }
  }

  if (definition.scope === "warehouse-company") {
    const values = [
      context.organizationId,
      scopedInput[definition.relationField],
      context.activeCompanyId,
    ];
    let branchClause = "";
    if (context.activeBranchId) {
      values.push(context.activeBranchId);
      branchClause = "AND (branch_id IS NULL OR branch_id = $4)";
    }
    const result = await client.query(
      `
        SELECT id
        FROM tenant.warehouses
        WHERE organization_id = $1
          AND id = $2
          AND company_id = $3
          ${branchClause}
      `,
      values,
    );
    if (!result.rows[0]) {
      throw new BusinessDataError(
        403,
        "The selected warehouse is outside the active operating context.",
      );
    }
  }

  return scopedInput;
}

async function assertExistingRecord(client, context, resource, id) {
  const definition = definitionFor(resource);
  const parameters = [context.organizationId, id];
  const scopeClause = buildScopeClause(definition, context, parameters, "t");
  const result = await client.query(
    `
      SELECT t.*
      FROM ${definition.table} t
      WHERE t.organization_id = $1
        AND t.id = $2
        ${scopeClause}
      LIMIT 1
    `,
    parameters,
  );

  if (!result.rows[0]) {
    throw new BusinessDataError(
      404,
      "The requested record was not found in the active tenant context.",
    );
  }

  return result.rows[0];
}

export async function listBusinessDataRecords(
  client,
  context,
  resource,
  options = {},
) {
  const definition = definitionFor(resource);
  const limit = numericLimit(options.limit, 100, 5000);
  const offset = numericLimit(options.offset, 0, 100000);
  const parameters = [context.organizationId];

  const scopeClause = buildScopeClause(definition, context, parameters, "t");
  const searchClause = buildSearchClause(
    definition,
    options.search,
    parameters,
    "t",
  );
  const statusClause = buildStatusClause(options.status, parameters, "t");

  const where = `
    WHERE t.organization_id = $1
      ${scopeClause}
      ${searchClause}
      ${statusClause}
  `;

  const countResult = await client.query(
    `SELECT count(*)::int AS count FROM ${definition.table} t ${where}`,
    parameters,
  );

  const limitParameter = addParameter(parameters, limit);
  const offsetParameter = addParameter(parameters, offset);

  const result = await client.query(
    `
      SELECT t.*
      FROM ${definition.table} t
      ${where}
      ORDER BY ${definition.orderBy}
      LIMIT ${limitParameter}
      OFFSET ${offsetParameter}
    `,
    parameters,
  );

  return {
    rows: result.rows.map(camelizeRow),
    total: Number(countResult.rows[0]?.count || 0),
    limit,
    offset,
  };
}

export async function createBusinessDataRecord(
  client,
  context,
  resource,
  input,
) {
  const definition = definitionFor(resource);

  try {
    const scopedInput = await assertRelationScope(
      client,
      context,
      definition,
      input,
    );

    if (resource === "currencies" && scopedInput.isBase) {
      await client.query(
        `
          UPDATE tenant.currencies
          SET is_base = false, updated_by = $2, updated_at = now()
          WHERE organization_id = $1 AND is_base = true
        `,
        [context.organizationId, context.userId],
      );
    }

    const entries = Object.entries(definition.fields);
    const columns = entries.map(([, column]) => column);
    const parameters = [
      context.organizationId,
      ...entries.map(([field]) => scopedInput[field] ?? null),
      context.userId,
      context.userId,
    ];
    const placeholders = parameters.map((_value, index) => `$${index + 1}`);

    const result = await client.query(
      `
        INSERT INTO ${definition.table} (
          organization_id,
          ${columns.join(", ")},
          created_by,
          updated_by
        )
        VALUES (${placeholders.join(", ")})
        RETURNING *
      `,
      parameters,
    );

    if (resource === "payment-terms") {
      const term = result.rows[0];
      await client.query(
        `
          INSERT INTO tenant.payment_term_lines (
            organization_id,
            payment_term_id,
            sequence,
            due_days,
            percentage,
            created_by,
            updated_by
          )
          VALUES ($1, $2, 1, $3, 100, $4, $4)
        `,
        [
          context.organizationId,
          term.id,
          scopedInput.defaultDueDays,
          context.userId,
        ],
      );
    }

    return camelizeRow(result.rows[0]);
  } catch (error) {
    throw databaseError(error);
  }
}

export async function updateBusinessDataRecord(
  client,
  context,
  resource,
  id,
  input,
) {
  const definition = definitionFor(resource);

  try {
    const existingRow = await assertExistingRecord(
      client,
      context,
      resource,
      id,
    );
    const suppliedFields = Object.keys(input).filter((field) =>
      Object.hasOwn(definition.fields, field),
    );
    if (!suppliedFields.length) {
      throw new BusinessDataError(
        400,
        "Provide at least one supported field to update.",
        "EMPTY_PATCH",
      );
    }

    const mergedInput = {
      ...camelizeRow(existingRow),
      ...input,
    };
    const scopedInput = await assertRelationScope(
      client,
      context,
      definition,
      mergedInput,
    );

    if (
      resource === "currencies" &&
      suppliedFields.includes("isBase") &&
      scopedInput.isBase
    ) {
      await client.query(
        `
          UPDATE tenant.currencies
          SET is_base = false, updated_by = $2, updated_at = now()
          WHERE organization_id = $1
            AND id <> $3
            AND is_base = true
        `,
        [context.organizationId, context.userId, id],
      );
    }

    const parameters = [id, context.organizationId];
    const assignments = [];
    for (const field of suppliedFields) {
      parameters.push(scopedInput[field] ?? null);
      assignments.push(
        `${definition.fields[field]} = $${parameters.length}`,
      );
    }
    parameters.push(context.userId);
    const updatedByParameter = `$${parameters.length}`;

    const result = await client.query(
      `
        UPDATE ${definition.table}
        SET
          ${assignments.join(", ")},
          updated_by = ${updatedByParameter},
          updated_at = now()
        WHERE id = $1
          AND organization_id = $2
        RETURNING *
      `,
      parameters,
    );

    if (!result.rows[0]) {
      throw new BusinessDataError(404, "Record not found.");
    }

    if (
      resource === "payment-terms" &&
      suppliedFields.includes("defaultDueDays")
    ) {
      await client.query(
        `
          INSERT INTO tenant.payment_term_lines (
            organization_id,
            payment_term_id,
            sequence,
            due_days,
            percentage,
            created_by,
            updated_by
          )
          VALUES ($1, $2, 1, $3, 100, $4, $4)
          ON CONFLICT (organization_id, payment_term_id, sequence)
          DO UPDATE SET
            due_days = EXCLUDED.due_days,
            percentage = EXCLUDED.percentage,
            updated_by = EXCLUDED.updated_by,
            updated_at = now()
        `,
        [
          context.organizationId,
          id,
          scopedInput.defaultDueDays,
          context.userId,
        ],
      );
    }

    return camelizeRow(result.rows[0]);
  } catch (error) {
    throw databaseError(error);
  }
}

export async function archiveBusinessDataRecord(client, context, resource, id) {
  const definition = definitionFor(resource);

  try {
    const existing = await assertExistingRecord(client, context, resource, id);

    if (resource === "currencies" && existing.is_base) {
      throw new BusinessDataError(409, "The base currency cannot be archived.");
    }

    const result = await client.query(
      `
        UPDATE ${definition.table}
        SET status = $3, updated_by = $4, updated_at = now()
        WHERE id = $1 AND organization_id = $2
        RETURNING *
      `,
      [id, context.organizationId, definition.archiveStatus, context.userId],
    );

    return camelizeRow(result.rows[0]);
  } catch (error) {
    throw databaseError(error);
  }
}

async function optionRows(client, sql, values) {
  const result = await client.query(sql, values);
  return result.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
  }));
}

export async function getBusinessDataOptions(client, context) {
  const companyScope = context.allowAllCompanies
    ? ""
    : "AND $2::uuid IS NOT NULL AND id = $2";
  const companyValues = context.allowAllCompanies
    ? [context.organizationId]
    : [context.organizationId, context.activeCompanyId];

  const branchScope = context.allowAllCompanies
    ? ""
    : context.activeBranchId
      ? "AND id = $2"
      : "AND false";
  const branchValues = context.allowAllCompanies
    ? [context.organizationId]
    : context.activeBranchId
      ? [context.organizationId, context.activeBranchId]
      : [context.organizationId];

  const companies = await optionRows(
    client,
    `
      SELECT id, name
      FROM public.companies
      WHERE organization_id = $1
        AND status = 'active'
        ${companyScope}
      ORDER BY is_primary DESC, name
    `,
    companyValues,
  );

  const branches = await optionRows(
    client,
    `
      SELECT id, name
      FROM public.branches
      WHERE organization_id = $1
        AND status = 'active'
        ${branchScope}
      ORDER BY is_primary DESC, name
    `,
    branchValues,
  );

  const parties = await optionRows(
    client,
    `
      SELECT id, display_name AS name
      FROM tenant.business_parties
      WHERE organization_id = $1
        AND status = 'active'
        ${
          context.allowAllCompanies
            ? ""
            : "AND $2::uuid IS NOT NULL AND (company_id IS NULL OR company_id = $2)"
        }
      ORDER BY display_name
    `,
    context.allowAllCompanies
      ? [context.organizationId]
      : [context.organizationId, context.activeCompanyId],
  );

  const uoms = await optionRows(
    client,
    `
      SELECT id, code || ' — ' || name AS name
      FROM tenant.units_of_measure
      WHERE organization_id = $1 AND status = 'active'
      ORDER BY category, name
    `,
    [context.organizationId],
  );

  const itemGroups = await optionRows(
    client,
    `
      SELECT id, name
      FROM tenant.item_groups
      WHERE organization_id = $1 AND status = 'active'
      ORDER BY name
    `,
    [context.organizationId],
  );

  const taxCategories = await optionRows(
    client,
    `
      SELECT id, name
      FROM tenant.tax_categories
      WHERE organization_id = $1 AND status = 'active'
      ORDER BY name
    `,
    [context.organizationId],
  );

  const warehouses = await optionRows(
    client,
    `
      SELECT id, name
      FROM tenant.warehouses
      WHERE organization_id = $1
        AND status = 'active'
        ${context.allowAllCompanies ? "" : "AND $2::uuid IS NOT NULL AND company_id = $2"}
        ${
          context.allowAllCompanies
            ? ""
            : context.activeBranchId
              ? "AND (branch_id IS NULL OR branch_id = $3)"
              : "AND false"
        }
      ORDER BY name
    `,
    context.allowAllCompanies
      ? [context.organizationId]
      : context.activeBranchId
        ? [
            context.organizationId,
            context.activeCompanyId,
            context.activeBranchId,
          ]
        : [context.organizationId, context.activeCompanyId],
  );

  const warehouseLocations = await optionRows(
    client,
    `
      SELECT location.id, warehouse.name || ' / ' || location.name AS name
      FROM tenant.warehouse_locations location
      JOIN tenant.warehouses warehouse
        ON warehouse.id = location.warehouse_id
       AND warehouse.organization_id = location.organization_id
      WHERE location.organization_id = $1
        AND location.status = 'active'
        ${context.allowAllCompanies ? "" : "AND $2::uuid IS NOT NULL AND warehouse.company_id = $2"}
        ${
          context.allowAllCompanies
            ? ""
            : context.activeBranchId
              ? "AND (warehouse.branch_id IS NULL OR warehouse.branch_id = $3)"
              : "AND false"
        }
      ORDER BY warehouse.name, location.name
    `,
    context.allowAllCompanies
      ? [context.organizationId]
      : context.activeBranchId
        ? [
            context.organizationId,
            context.activeCompanyId,
            context.activeBranchId,
          ]
        : [context.organizationId, context.activeCompanyId],
  );

  const paymentTerms = await optionRows(
    client,
    `
      SELECT id, name
      FROM tenant.payment_terms
      WHERE organization_id = $1 AND status = 'active'
      ORDER BY default_due_days, name
    `,
    [context.organizationId],
  );

  const currencies = await optionRows(
    client,
    `
      SELECT code AS id, code || ' — ' || name AS name
      FROM tenant.currencies
      WHERE organization_id = $1 AND status = 'active'
      ORDER BY is_base DESC, code
    `,
    [context.organizationId],
  );

  const items = await optionRows(
    client,
    `
      SELECT id, code || ' — ' || name AS name
      FROM tenant.items
      WHERE organization_id = $1
        AND status = 'active'
        ${
          context.allowAllCompanies
            ? ""
            : "AND $2::uuid IS NOT NULL AND (company_id IS NULL OR company_id = $2)"
        }
      ORDER BY name
    `,
    context.allowAllCompanies
      ? [context.organizationId]
      : [context.organizationId, context.activeCompanyId],
  );

  const priceLists = await optionRows(
    client,
    `
      SELECT id, name
      FROM tenant.price_lists
      WHERE organization_id = $1 AND status = 'active'
      ORDER BY price_list_type, name
    `,
    [context.organizationId],
  );

  return {
    companies,
    branches,
    parties,
    uoms,
    itemGroups,
    taxCategories,
    warehouses,
    warehouseLocations,
    paymentTerms,
    currencies,
    items,
    priceLists,
  };
}

export async function getBusinessDataOverview(client, context) {
  const result = await client.query(
    `
      SELECT
        (
          SELECT count(*)::int
          FROM tenant.business_parties party
          WHERE party.organization_id = $1 AND party.status = 'active'
            AND ($4::boolean OR ($2::uuid IS NOT NULL AND (party.company_id IS NULL OR party.company_id = $2)))
        ) AS parties,
        (
          SELECT count(*)::int
          FROM tenant.contacts contact
          WHERE contact.organization_id = $1 AND contact.status = 'active'
            AND ($4::boolean OR ($2::uuid IS NOT NULL AND EXISTS (
              SELECT 1
              FROM tenant.business_parties party
              WHERE party.organization_id = contact.organization_id
                AND party.id = contact.party_id
                AND (party.company_id IS NULL OR party.company_id = $2)
            )))
        ) AS contacts,
        (
          SELECT count(*)::int
          FROM tenant.items item
          WHERE item.organization_id = $1 AND item.status = 'active'
            AND ($4::boolean OR ($2::uuid IS NOT NULL AND (item.company_id IS NULL OR item.company_id = $2)))
        ) AS items,
        (
          SELECT count(*)::int
          FROM tenant.warehouses warehouse
          WHERE warehouse.organization_id = $1 AND warehouse.status = 'active'
            AND ($4::boolean OR ($2::uuid IS NOT NULL AND warehouse.company_id = $2))
            AND ($4::boolean OR ($3::uuid IS NOT NULL AND (warehouse.branch_id IS NULL OR warehouse.branch_id = $3)))
        ) AS warehouses,
        (
          SELECT count(*)::int
          FROM tenant.tax_rates tax_rate
          WHERE tax_rate.organization_id = $1 AND tax_rate.status = 'active'
            AND ($4::boolean OR ($2::uuid IS NOT NULL AND (tax_rate.company_id IS NULL OR tax_rate.company_id = $2)))
        ) AS tax_rates,
        (
          SELECT count(*)::int
          FROM tenant.fiscal_periods fiscal_period
          WHERE fiscal_period.organization_id = $1
            AND ($4::boolean OR ($2::uuid IS NOT NULL AND fiscal_period.company_id = $2))
        ) AS fiscal_periods,
        (
          SELECT count(*)::int
          FROM tenant.currencies
          WHERE organization_id = $1 AND status = 'active'
        ) AS currencies,
        (
          SELECT count(*)::int
          FROM tenant.master_data_import_jobs
          WHERE organization_id = $1
            AND status IN ('failed', 'completed_with_errors')
        ) AS import_issues
    `,
    [
      context.organizationId,
      context.activeCompanyId,
      context.activeBranchId,
      Boolean(context.allowAllCompanies),
    ],
  );

  return camelizeRow(result.rows[0] || {});
}

export async function createImportJob(client, context, resource, input) {
  definitionFor(resource);
  const result = await client.query(
    `
      INSERT INTO tenant.master_data_import_jobs (
        organization_id,
        resource,
        file_name,
        status,
        total_rows,
        created_by
      )
      VALUES ($1, $2, $3, 'processing', $4, $5)
      RETURNING id
    `,
    [
      context.organizationId,
      resource,
      input.fileName || null,
      input.totalRows,
      context.userId,
    ],
  );
  return String(result.rows[0].id);
}

export async function completeImportJob(client, context, jobId, input) {
  await client.query(
    `
      UPDATE tenant.master_data_import_jobs
      SET
        status = $3,
        processed_rows = $4,
        succeeded_rows = $5,
        failed_rows = $6,
        error_report = $7::jsonb,
        completed_at = now()
      WHERE id = $1 AND organization_id = $2
    `,
    [
      jobId,
      context.organizationId,
      input.status,
      input.processedRows,
      input.succeededRows,
      input.failedRows,
      JSON.stringify(input.errors || []),
    ],
  );
}

export async function seedBusinessDataFoundation(client, context) {
  const organizationResult = await client.query(
    `
      SELECT
        organization.id,
        organization.country_code,
        organization.base_currency,
        organization.fiscal_year_start_month,
        company.id AS company_id,
        branch.id AS branch_id,
        branch.name AS branch_name,
        branch.code AS branch_code
      FROM public.organizations organization
      JOIN public.companies company
        ON company.organization_id = organization.id
       AND company.is_primary = true
      JOIN public.branches branch
        ON branch.organization_id = organization.id
       AND branch.company_id = company.id
       AND branch.is_primary = true
      WHERE organization.id = $1
      LIMIT 1
    `,
    [context.organizationId],
  );

  const organization = organizationResult.rows[0];
  if (!organization) {
    throw new BusinessDataError(
      409,
      "The organisation requires a primary company and branch before business data can be seeded.",
    );
  }

  const currencies = [
    ["INR", "Indian Rupee", "₹", 2],
    ["USD", "US Dollar", "$", 2],
    ["EUR", "Euro", "€", 2],
    ["GBP", "Pound Sterling", "£", 2],
    ["AED", "UAE Dirham", "د.إ", 2],
  ];

  for (const [code, name, symbol, decimalPlaces] of currencies) {
    await client.query(
      `
        INSERT INTO tenant.currencies (
          organization_id, code, name, symbol, decimal_places,
          is_base, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
        ON CONFLICT (organization_id, code) DO UPDATE SET
          name = EXCLUDED.name,
          symbol = EXCLUDED.symbol,
          decimal_places = EXCLUDED.decimal_places,
          is_base = EXCLUDED.is_base,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
      `,
      [
        context.organizationId,
        code,
        name,
        symbol,
        decimalPlaces,
        code === String(organization.base_currency).trim(),
        context.userId,
      ],
    );
  }

  const units = [
    ["EA", "Each", "quantity", 0, true],
    ["NOS", "Numbers", "quantity", 0, false],
    ["KG", "Kilogram", "weight", 3, true],
    ["G", "Gram", "weight", 3, false],
    ["L", "Litre", "volume", 3, true],
    ["ML", "Millilitre", "volume", 3, false],
    ["M", "Metre", "length", 3, true],
    ["CM", "Centimetre", "length", 3, false],
    ["SQM", "Square metre", "area", 3, true],
    ["HOUR", "Hour", "time", 2, true],
    ["DAY", "Day", "time", 2, false],
    ["BOX", "Box", "packaging", 0, false],
  ];

  for (const [code, name, category, decimalPlaces, isBase] of units) {
    await client.query(
      `
        INSERT INTO tenant.units_of_measure (
          organization_id, code, name, category, decimal_places,
          is_base, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
        ON CONFLICT (organization_id, code) DO NOTHING
      `,
      [
        context.organizationId,
        code,
        name,
        category,
        decimalPlaces,
        isBase,
        context.userId,
      ],
    );
  }

  const categories = [
    ["GST-TAXABLE", "GST taxable", "Standard taxable supply under GST."],
    ["GST-EXEMPT", "GST exempt", "Exempt supply under GST."],
    ["NON-GST", "Non-GST", "Supply outside GST scope."],
  ];

  for (const [code, name, description] of categories) {
    await client.query(
      `
        INSERT INTO tenant.tax_categories (
          organization_id, code, name, description, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $5)
        ON CONFLICT (organization_id, code) DO NOTHING
      `,
      [context.organizationId, code, name, description, context.userId],
    );
  }

  const terms = [
    ["IMMEDIATE", "Immediate", "Payment is due immediately.", 0],
    ["NET-7", "Net 7", "Payment is due within 7 days.", 7],
    ["NET-15", "Net 15", "Payment is due within 15 days.", 15],
    ["NET-30", "Net 30", "Payment is due within 30 days.", 30],
    ["NET-45", "Net 45", "Payment is due within 45 days.", 45],
    ["NET-60", "Net 60", "Payment is due within 60 days.", 60],
  ];

  for (const [code, name, description, dueDays] of terms) {
    const termResult = await client.query(
      `
        INSERT INTO tenant.payment_terms (
          organization_id, code, name, description, default_due_days,
          created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $6)
        ON CONFLICT (organization_id, code) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          default_due_days = EXCLUDED.default_due_days,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
        RETURNING id
      `,
      [
        context.organizationId,
        code,
        name,
        description,
        dueDays,
        context.userId,
      ],
    );

    await client.query(
      `
        INSERT INTO tenant.payment_term_lines (
          organization_id, payment_term_id, sequence, due_days,
          percentage, created_by, updated_by
        )
        VALUES ($1, $2, 1, $3, 100, $4, $4)
        ON CONFLICT (organization_id, payment_term_id, sequence)
        DO UPDATE SET
          due_days = EXCLUDED.due_days,
          percentage = EXCLUDED.percentage,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
      `,
      [context.organizationId, termResult.rows[0].id, dueDays, context.userId],
    );
  }

  for (const [code, name, priceListType] of [
    ["STANDARD-SALES", "Standard sales price", "sales"],
    ["STANDARD-PURCHASE", "Standard purchase price", "purchase"],
  ]) {
    await client.query(
      `
        INSERT INTO tenant.price_lists (
          organization_id, code, name, price_list_type, currency_code,
          tax_inclusive, created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, false, $6, $6)
        ON CONFLICT (organization_id, code) DO NOTHING
      `,
      [
        context.organizationId,
        code,
        name,
        priceListType,
        String(organization.base_currency).trim(),
        context.userId,
      ],
    );
  }

  const warehouseResult = await client.query(
    `
      INSERT INTO tenant.warehouses (
        organization_id, company_id, branch_id, name, code,
        warehouse_type, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, 'stores', $6, $6)
      ON CONFLICT (organization_id, code) DO UPDATE SET
        name = EXCLUDED.name,
        company_id = EXCLUDED.company_id,
        branch_id = EXCLUDED.branch_id,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
      RETURNING id
    `,
    [
      context.organizationId,
      organization.company_id,
      organization.branch_id,
      `${organization.branch_name} Main Warehouse`,
      `${organization.branch_code}-MAIN`,
      context.userId,
    ],
  );

  await client.query(
    `
      INSERT INTO tenant.warehouse_locations (
        organization_id, warehouse_id, name, code,
        location_type, created_by, updated_by
      )
      VALUES ($1, $2, 'Main', 'MAIN', 'zone', $3, $3)
      ON CONFLICT (organization_id, warehouse_id, code) DO NOTHING
    `,
    [context.organizationId, warehouseResult.rows[0].id, context.userId],
  );

  await client.query(
    `
      WITH period AS (
        SELECT make_date(
          CASE
            WHEN extract(month FROM current_date)::integer >= $3
            THEN extract(year FROM current_date)::integer
            ELSE extract(year FROM current_date)::integer - 1
          END,
          $3,
          1
        ) AS start_date
      )
      INSERT INTO tenant.fiscal_periods (
        organization_id, company_id, name, fiscal_year,
        start_date, end_date, created_by, updated_by
      )
      SELECT
        $1,
        $2,
        'FY ' || to_char(start_date, 'YYYY')
          || '-' || to_char(start_date + interval '1 year', 'YY'),
        to_char(start_date, 'YYYY')
          || '-' || to_char(start_date + interval '1 year', 'YY'),
        start_date,
        (start_date + interval '1 year - 1 day')::date,
        $4,
        $4
      FROM period
      ON CONFLICT (organization_id, company_id, start_date, end_date)
      DO NOTHING
    `,
    [
      context.organizationId,
      organization.company_id,
      organization.fiscal_year_start_month,
      context.userId,
    ],
  );

  if (String(organization.country_code).trim() === "IN") {
    const categoryResult = await client.query(
      `
        SELECT id
        FROM tenant.tax_categories
        WHERE organization_id = $1 AND code = 'GST-TAXABLE'
        LIMIT 1
      `,
      [context.organizationId],
    );

    for (const rate of [0, 5, 12, 18, 28]) {
      await client.query(
        `
          INSERT INTO tenant.tax_rates (
            organization_id, company_id, tax_category_id, name, code,
            tax_type, rate, effective_from, created_by, updated_by
          )
          VALUES (
            $1, $2, $3, $4, $5, 'gst', $6, current_date, $7, $7
          )
          ON CONFLICT (organization_id, company_id, code, effective_from)
          DO NOTHING
        `,
        [
          context.organizationId,
          organization.company_id,
          categoryResult.rows[0].id,
          `GST ${rate}%`,
          `GST-${rate}`,
          rate,
          context.userId,
        ],
      );
    }
  }
}
export * from "./crm.js";
export * from "./billing.js";
export * from "./sales/index.js";
