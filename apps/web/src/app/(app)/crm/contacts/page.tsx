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
export const metadata: Metadata = { title: "Contacts" };

const definition = {
  ...businessDataDefinitions.contacts,
  eyebrow: "CRM · Relationships",
  description:
    "Manage customer contacts, communication details and primary relationship ownership.",
};

export default async function CrmContactsPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();

  const context = businessDataContext(session);
  const result = await tenantTransaction(
    context.organizationId,
    async (client) => ({
      records: await listBusinessDataRecords(client, context, "contacts", {
        status: "all",
        limit: 500,
      }),
      options: await getBusinessDataOptions(client, context),
    }),
  );
  const rows = JSON.parse(JSON.stringify(result.records.rows)) as Array<
    Record<string, unknown>
  >;

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
        rows={rows}
        total={result.records.total}
        options={result.options}
        canManage={hasPermission(session, PERMISSIONS.partiesManage)}
        canImport={
          hasPermission(session, PERMISSIONS.partiesManage) &&
          hasPermission(session, PERMISSIONS.businessDataImport)
        }
        detailBasePath="/crm/contacts"
        presentation="crm"
      />
    </>
  );
}
