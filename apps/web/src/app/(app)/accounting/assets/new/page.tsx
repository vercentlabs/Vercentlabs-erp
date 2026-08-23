import { getAccountingOptions, listAssetCategories } from "@vercentlabs/api";
import SimpleAccountingForm from "@/modules/accounting/components/simple-accounting-form";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { accountingContext } from "@/modules/accounting";
import { tenantTransaction } from "@/core/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

export default async function NewAssetPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.accountingAssetsManage))
    return (
      <section className="panel">
        <h1>Asset-management permission required</h1>
      </section>
    );
  if (!session.activeCompanyId)
    return (
      <section className="panel">
        <h1>Select a company first</h1>
      </section>
    );
  const context = accountingContext(session);
  const data = (await tenantTransaction(
    context.organizationId,
    async (client) => ({
      options: await getAccountingOptions(
        client,
        context,
        session.activeCompanyId,
      ),
      categories: await listAssetCategories(client, context, {
        companyId: session.activeCompanyId,
      }),
    }),
  )) as {
    options: {
      company: Row;
      ledgers: Row[];
      branches: Row[];
      departments: Row[];
      costCenters: Row[];
      currencies: Row[];
    };
    categories: Row[];
  };
  const companyId = String(data.options.company.id);
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Fixed assets</p>
          <h1>Register an asset</h1>
          <p>
            Create the asset record first. Capitalization and depreciation
            remain separate governed actions.
          </p>
        </div>
      </section>
      <SimpleAccountingForm
        title="Asset acquisition"
        endpoint="/api/accounting/assets"
        submitLabel="Create asset"
        redirectTo="/accounting/assets"
        basePayload={{ companyId }}
        fields={[
          {
            name: "categoryId",
            label: "Asset category",
            type: "select",
            required: true,
            options: data.categories.map((row) => ({
              value: String(row.id),
              label: `${String(row.code)} · ${String(row.name)}`,
            })),
          },
          { name: "name", label: "Asset name", required: true },
          { name: "serialNumber", label: "Serial number" },
          {
            name: "acquisitionDate",
            label: "Acquisition date",
            type: "date",
            required: true,
            defaultValue: new Date().toISOString().slice(0, 10),
          },
          {
            name: "currencyCode",
            label: "Currency",
            type: "select",
            required: true,
            defaultValue: String(data.options.company.base_currency),
            options: data.options.currencies.map((row) => ({
              value: String(row.code),
              label: `${String(row.code)} · ${String(row.name)}`,
            })),
          },
          {
            name: "acquisitionCost",
            label: "Acquisition cost",
            type: "number",
            required: true,
          },
          {
            name: "salvageValue",
            label: "Salvage value",
            type: "number",
            defaultValue: 0,
          },
          {
            name: "usefulLifeMonths",
            label: "Useful life (months)",
            type: "number",
            defaultValue: 60,
          },
          {
            name: "depreciationMethod",
            label: "Depreciation method",
            type: "select",
            defaultValue: "straight_line",
            options: [
              { value: "straight_line", label: "Straight line" },
              { value: "declining_balance", label: "Declining balance" },
              { value: "units_of_production", label: "Units of production" },
              { value: "none", label: "No depreciation" },
            ],
          },
          {
            name: "branchId",
            label: "Branch",
            type: "select",
            options: data.options.branches.map((row) => ({
              value: String(row.id),
              label: String(row.name),
            })),
          },
          {
            name: "departmentId",
            label: "Department",
            type: "select",
            options: data.options.departments.map((row) => ({
              value: String(row.id),
              label: String(row.name),
            })),
          },
          {
            name: "costCenterId",
            label: "Cost centre",
            type: "select",
            options: data.options.costCenters.map((row) => ({
              value: String(row.id),
              label: String(row.name),
            })),
          },
          { name: "location", label: "Location" },
        ]}
      />
    </>
  );
}
