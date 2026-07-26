import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getBusinessDataOptions, listBusinessDataRecords } from "@vercentlabs/api";

import BusinessDataManager from "@/components/business-data-manager";
import { requireWorkspace } from "@/lib/auth";
import {
  businessDataContext,
  businessDataDefinitions,
  isBusinessDataDefinition,
} from "@/lib/business-data";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ resource: string }>;
}): Promise<Metadata> {
  const { resource } = await params;
  return {
    title: isBusinessDataDefinition(resource)
      ? businessDataDefinitions[resource].title
      : "Master data",
  };
}

export default async function BusinessDataResourcePage({
  params,
}: {
  params: Promise<{ resource: string }>;
}) {
  const { resource } = await params;
  if (!isBusinessDataDefinition(resource)) notFound();

  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.businessDataView)) {
    notFound();
  }

  const definition = businessDataDefinitions[resource];
  const context = businessDataContext(session);

  const result = await tenantTransaction(
    context.organizationId,
    async (client) => {
      const records = await listBusinessDataRecords(client, context, resource, {
        status: "all",
        limit: 500,
      });
      const options = await getBusinessDataOptions(client, context);
      return { records, options };
    },
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
          {context.activeCompanyId
            ? "Active company context"
            : "Organisation-wide context"}
        </span>
      </section>

      <BusinessDataManager
        definition={definition}
        rows={rows}
        total={result.records.total}
        options={result.options}
        canManage={hasPermission(session, definition.managePermission)}
        canImport={
          hasPermission(session, definition.managePermission) &&
          hasPermission(session, PERMISSIONS.businessDataImport)
        }
      />
    </>
  );
}
