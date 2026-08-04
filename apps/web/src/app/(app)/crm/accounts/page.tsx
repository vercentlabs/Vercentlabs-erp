import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  getBusinessDataOptions,
  listBusinessDataRecords,
} from "@vercentlabs/api";

import BusinessDataManager from "@/components/business-data-manager";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import {
  businessDataContext,
  businessDataDefinitions,
} from "@/lib/business-data";
import { tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Accounts" };

const definition = {
  ...businessDataDefinitions.parties,
  title: "Accounts",
  singular: "account",
  eyebrow: "CRM · Customers",
  description:
    "Manage customer and prospect accounts, commercial identity and shared relationship data.",
};

export default async function CrmAccountsPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();

  const context = businessDataContext(session);
  const result = await tenantTransaction(
    context.organizationId,
    async (client) => ({
      records: await listBusinessDataRecords(client, context, "parties", {
        status: "all",
        limit: 500,
      }),
      options: await getBusinessDataOptions(client, context),
    }),
  );
  const rows = JSON.parse(JSON.stringify(result.records.rows)) as Array<
    Record<string, unknown>
  >;
  const accounts = rows.filter((row) =>
    ["customer", "both", "prospect"].includes(String(row.partyType)),
  );

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">{definition.eyebrow}</p>
          <h1>{definition.title}</h1>
          <p>{definition.description}</p>
        </div>
        <span className="status-badge neutral">
          {session.companyName || "Organisation-wide"}
        </span>
      </section>

      <BusinessDataManager
        definition={definition}
        rows={accounts}
        total={accounts.length}
        options={result.options}
        canManage={hasPermission(session, PERMISSIONS.partiesManage)}
        canImport={
          hasPermission(session, PERMISSIONS.partiesManage) &&
          hasPermission(session, PERMISSIONS.businessDataImport)
        }
        detailBasePath="/crm/accounts"
        presentation="crm"
      />
    </>
  );
}
