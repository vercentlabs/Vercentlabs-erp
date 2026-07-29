import { randomUUID } from "node:crypto";
import { initializeAccountingCompany } from "@vercentlabs/api";
import { setTenantContext } from "@vercentlabs/database";
import type { PoolClient } from "pg";

import { query, transaction } from "@/lib/db";
import { HttpError } from "@/lib/http";

export type ResourceKey =
  | "organization"
  | "companies"
  | "branches"
  | "departments"
  | "teams"
  | "cost-centres"
  | "numbering-series";

export const resourceDefinitions: Record<
  ResourceKey,
  {
    title: string;
    eyebrow: string;
    description: string;
    permission: string;
    fields: Array<{
      name: string;
      label: string;
      type: "text" | "number" | "select" | "checkbox";
      required?: boolean;
      optionsKey?: "companies" | "branches" | "departments";
      options?: Array<{ value: string; label: string }>;
    }>;
  }
> = {
  organization: {
    title: "Organisation settings",
    eyebrow: "Organisation",
    description:
      "Maintain the legal operating context shared by the ERP workspace.",
    permission: "organization.manage",
    fields: [
      {
        name: "name",
        label: "Organisation name",
        type: "text",
        required: true,
      },
      {
        name: "countryCode",
        label: "Country code",
        type: "text",
        required: true,
      },
      { name: "timezone", label: "Timezone", type: "text", required: true },
      {
        name: "baseCurrency",
        label: "Base currency",
        type: "text",
        required: true,
      },
      {
        name: "fiscalYearStartMonth",
        label: "Fiscal year start month",
        type: "number",
        required: true,
      },
    ],
  },
  companies: {
    title: "Companies",
    eyebrow: "Organisation structure",
    description: "Create and maintain legal companies inside the organisation.",
    permission: "company.manage",
    fields: [
      { name: "name", label: "Display name", type: "text", required: true },
      { name: "legalName", label: "Legal name", type: "text", required: true },
      { name: "code", label: "Company code", type: "text", required: true },
      {
        name: "countryCode",
        label: "Country code",
        type: "text",
        required: true,
      },
      {
        name: "baseCurrency",
        label: "Base currency",
        type: "text",
        required: true,
      },
      { name: "taxId", label: "Tax identifier", type: "text" },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ],
      },
    ],
  },
  branches: {
    title: "Branches",
    eyebrow: "Organisation structure",
    description:
      "Maintain branches, plants, warehouses or other operating locations.",
    permission: "branch.manage",
    fields: [
      {
        name: "companyId",
        label: "Company",
        type: "select",
        required: true,
        optionsKey: "companies",
      },
      { name: "name", label: "Branch name", type: "text", required: true },
      { name: "code", label: "Branch code", type: "text", required: true },
      { name: "timezone", label: "Timezone", type: "text", required: true },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ],
      },
    ],
  },
  departments: {
    title: "Departments",
    eyebrow: "Organisation structure",
    description:
      "Create departments and scope them to a company or branch when required.",
    permission: "department.manage",
    fields: [
      {
        name: "companyId",
        label: "Company",
        type: "select",
        optionsKey: "companies",
      },
      {
        name: "branchId",
        label: "Branch",
        type: "select",
        optionsKey: "branches",
      },
      { name: "name", label: "Department name", type: "text", required: true },
      { name: "code", label: "Department code", type: "text", required: true },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ],
      },
    ],
  },
  teams: {
    title: "Teams",
    eyebrow: "Organisation structure",
    description: "Create operating teams and associate them with departments.",
    permission: "team.manage",
    fields: [
      {
        name: "departmentId",
        label: "Department",
        type: "select",
        optionsKey: "departments",
      },
      { name: "name", label: "Team name", type: "text", required: true },
      { name: "code", label: "Team code", type: "text", required: true },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ],
      },
    ],
  },
  "cost-centres": {
    title: "Cost centres",
    eyebrow: "Financial structure",
    description:
      "Maintain responsibility and reporting dimensions for business costs.",
    permission: "cost_center.manage",
    fields: [
      {
        name: "companyId",
        label: "Company",
        type: "select",
        optionsKey: "companies",
      },
      {
        name: "departmentId",
        label: "Department",
        type: "select",
        optionsKey: "departments",
      },
      { name: "name", label: "Cost centre name", type: "text", required: true },
      { name: "code", label: "Cost centre code", type: "text", required: true },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ],
      },
    ],
  },
  "numbering-series": {
    title: "Numbering series",
    eyebrow: "Platform settings",
    description: "Control identifiers for business records and documents.",
    permission: "numbering.manage",
    fields: [
      {
        name: "entityType",
        label: "Entity type",
        type: "text",
        required: true,
      },
      { name: "prefix", label: "Prefix", type: "text", required: true },
      {
        name: "nextNumber",
        label: "Next number",
        type: "number",
        required: true,
      },
      { name: "padding", label: "Padding", type: "number", required: true },
      {
        name: "fiscalYearReset",
        label: "Reset each fiscal year",
        type: "checkbox",
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "active", label: "Active" },
          { value: "inactive", label: "Inactive" },
        ],
      },
    ],
  },
};

export function isResourceKey(value: string): value is ResourceKey {
  return value in resourceDefinitions;
}

export async function listResource(
  resource: ResourceKey,
  organizationId: string,
) {
  switch (resource) {
    case "organization":
      return query(
        `SELECT id, name, country_code AS "countryCode", timezone, base_currency AS "baseCurrency", fiscal_year_start_month AS "fiscalYearStartMonth", status FROM organizations WHERE id = $1`,
        [organizationId],
      );
    case "companies":
      return query(
        `SELECT id, name, legal_name AS "legalName", code, country_code AS "countryCode", base_currency AS "baseCurrency", COALESCE(tax_id, '') AS "taxId", status, is_primary AS "isPrimary" FROM companies WHERE organization_id = $1 ORDER BY is_primary DESC, name`,
        [organizationId],
      );
    case "branches":
      return query(
        `SELECT b.id, b.company_id AS "companyId", c.name AS "companyName", b.name, b.code, b.timezone, b.status, b.is_primary AS "isPrimary" FROM branches b JOIN companies c ON c.id = b.company_id WHERE b.organization_id = $1 ORDER BY b.is_primary DESC, b.name`,
        [organizationId],
      );
    case "departments":
      return query(
        `SELECT d.id, d.company_id AS "companyId", c.name AS "companyName", d.branch_id AS "branchId", b.name AS "branchName", d.name, d.code, d.status FROM departments d LEFT JOIN companies c ON c.id = d.company_id LEFT JOIN branches b ON b.id = d.branch_id WHERE d.organization_id = $1 ORDER BY d.name`,
        [organizationId],
      );
    case "teams":
      return query(
        `SELECT t.id, t.department_id AS "departmentId", d.name AS "departmentName", t.name, t.code, t.status FROM teams t LEFT JOIN departments d ON d.id=t.department_id WHERE t.organization_id=$1 ORDER BY t.name`,
        [organizationId],
      );
    case "cost-centres":
      return query(
        `SELECT cc.id, cc.company_id AS "companyId", c.name AS "companyName", cc.department_id AS "departmentId", d.name AS "departmentName", cc.name, cc.code, cc.status FROM cost_centers cc LEFT JOIN companies c ON c.id = cc.company_id LEFT JOIN departments d ON d.id = cc.department_id WHERE cc.organization_id = $1 ORDER BY cc.name`,
        [organizationId],
      );
    case "numbering-series":
      return query(
        `SELECT id, entity_type AS "entityType", prefix, next_number AS "nextNumber", padding, fiscal_year_reset AS "fiscalYearReset", status FROM numbering_series WHERE organization_id = $1 ORDER BY entity_type`,
        [organizationId],
      );
  }
}

export async function resourceOptions(organizationId: string) {
  const [companies, branches, departments] = await Promise.all([
    query<{ id: string; name: string }>(
      "SELECT id, name FROM companies WHERE organization_id = $1 AND status = 'active' ORDER BY name",
      [organizationId],
    ),
    query<{ id: string; name: string }>(
      "SELECT id, name FROM branches WHERE organization_id = $1 AND status = 'active' ORDER BY name",
      [organizationId],
    ),
    query<{ id: string; name: string }>(
      "SELECT id, name FROM departments WHERE organization_id = $1 AND status = 'active' ORDER BY name",
      [organizationId],
    ),
  ]);
  return { companies, branches, departments };
}

async function grantNewScope(
  client: PoolClient,
  organizationId: string,
  userId: string,
  kind: "company" | "branch",
  id: string,
) {
  if (kind === "company") {
    await client.query(
      "INSERT INTO membership_company_access (organization_id, user_id, company_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [organizationId, userId, id],
    );
  } else {
    await client.query(
      "INSERT INTO membership_branch_access (organization_id, user_id, branch_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [organizationId, userId, id],
    );
  }
}

export async function createResource(
  resource: ResourceKey,
  organizationId: string,
  actorUserId: string,
  input: Record<string, unknown>,
  clientOverride?: PoolClient,
) {
  if (resource === "organization")
    throw new HttpError(405, "The organisation already exists.");
  const create = async (client: PoolClient) => {
    const id = randomUUID();
    switch (resource) {
      case "companies":
        await client.query(
          `INSERT INTO companies (id, organization_id, name, legal_name, code, country_code, base_currency, tax_id, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            organizationId,
            input.name,
            input.legalName,
            input.code,
            input.countryCode,
            input.baseCurrency,
            input.taxId || null,
            input.status,
          ],
        );
        await grantNewScope(client, organizationId, actorUserId, "company", id);
        await setTenantContext(client, organizationId);
        await initializeAccountingCompany(client, {
          organizationId,
          companyId: id,
          userId: actorUserId,
        });
        break;
      case "branches":
        await client.query(
          `INSERT INTO branches (id, organization_id, company_id, name, code, timezone, status) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            id,
            organizationId,
            input.companyId,
            input.name,
            input.code,
            input.timezone,
            input.status,
          ],
        );
        await grantNewScope(client, organizationId, actorUserId, "branch", id);
        break;
      case "departments":
        await client.query(
          `INSERT INTO departments (id, organization_id, company_id, branch_id, name, code, status) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            id,
            organizationId,
            input.companyId || null,
            input.branchId || null,
            input.name,
            input.code,
            input.status,
          ],
        );
        break;
      case "teams":
        await client.query(
          `INSERT INTO teams (id, organization_id, department_id, name, code, status) VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            id,
            organizationId,
            input.departmentId || null,
            input.name,
            input.code,
            input.status,
          ],
        );
        break;
      case "cost-centres":
        await client.query(
          `INSERT INTO cost_centers (id, organization_id, company_id, department_id, name, code, status) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            id,
            organizationId,
            input.companyId || null,
            input.departmentId || null,
            input.name,
            input.code,
            input.status,
          ],
        );
        break;
      case "numbering-series":
        await client.query(
          `INSERT INTO numbering_series (id, organization_id, entity_type, prefix, next_number, padding, fiscal_year_reset, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            organizationId,
            input.entityType,
            input.prefix,
            input.nextNumber,
            input.padding,
            input.fiscalYearReset,
            input.status,
          ],
        );
        break;
    }
    return { id };
  };
  return clientOverride ? create(clientOverride) : transaction(create);
}

export async function updateResource(
  resource: ResourceKey,
  organizationId: string,
  id: string,
  input: Record<string, unknown>,
) {
  switch (resource) {
    case "organization":
      await query(
        `UPDATE organizations SET name=$2, country_code=$3, timezone=$4, base_currency=$5, fiscal_year_start_month=$6, updated_at=now() WHERE id=$1`,
        [
          organizationId,
          input.name,
          input.countryCode,
          input.timezone,
          input.baseCurrency,
          input.fiscalYearStartMonth,
        ],
      );
      return;
    case "companies":
      await query(
        `UPDATE companies SET name=$3, legal_name=$4, code=$5, country_code=$6, base_currency=$7, tax_id=$8, status=$9, updated_at=now() WHERE id=$1 AND organization_id=$2`,
        [
          id,
          organizationId,
          input.name,
          input.legalName,
          input.code,
          input.countryCode,
          input.baseCurrency,
          input.taxId || null,
          input.status,
        ],
      );
      return;
    case "branches":
      await query(
        `UPDATE branches SET company_id=$3, name=$4, code=$5, timezone=$6, status=$7, updated_at=now() WHERE id=$1 AND organization_id=$2`,
        [
          id,
          organizationId,
          input.companyId,
          input.name,
          input.code,
          input.timezone,
          input.status,
        ],
      );
      return;
    case "departments":
      await query(
        `UPDATE departments SET company_id=$3, branch_id=$4, name=$5, code=$6, status=$7, updated_at=now() WHERE id=$1 AND organization_id=$2`,
        [
          id,
          organizationId,
          input.companyId || null,
          input.branchId || null,
          input.name,
          input.code,
          input.status,
        ],
      );
      return;
    case "teams":
      await query(
        `UPDATE teams SET department_id=$3, name=$4, code=$5, status=$6, updated_at=now() WHERE id=$1 AND organization_id=$2`,
        [
          id,
          organizationId,
          input.departmentId || null,
          input.name,
          input.code,
          input.status,
        ],
      );
      return;
    case "cost-centres":
      await query(
        `UPDATE cost_centers SET company_id=$3, department_id=$4, name=$5, code=$6, status=$7, updated_at=now() WHERE id=$1 AND organization_id=$2`,
        [
          id,
          organizationId,
          input.companyId || null,
          input.departmentId || null,
          input.name,
          input.code,
          input.status,
        ],
      );
      return;
    case "numbering-series":
      await query(
        `UPDATE numbering_series SET entity_type=$3, prefix=$4, next_number=$5, padding=$6, fiscal_year_reset=$7, status=$8, updated_at=now() WHERE id=$1 AND organization_id=$2`,
        [
          id,
          organizationId,
          input.entityType,
          input.prefix,
          input.nextNumber,
          input.padding,
          input.fiscalYearReset,
          input.status,
        ],
      );
      return;
  }
}
