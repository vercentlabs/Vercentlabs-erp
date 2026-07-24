import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCrmOptions, listCrmRecords } from "@vercent/api";
import CrmResourceManager from "@/components/crm-resource-manager";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext, crmDefinitions, isCrmDefinition } from "@/lib/crm";
import { canViewCrmResource } from "@/lib/crm-api";
import { tenantTransaction } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ resource: string }>;
}): Promise<Metadata> {
  const { resource } = await params;
  return {
    title: isCrmDefinition(resource) ? crmDefinitions[resource].title : "CRM",
  };
}
export default async function CrmResourcePage({
  params,
  searchParams,
}: {
  params: Promise<{ resource: string }>;
  searchParams: Promise<{ create?: string }>;
}) {
  const [{ resource }, query] = await Promise.all([params, searchParams]);
  if (
    !isCrmDefinition(resource) ||
    ["pipeline", "reports", "settings"].includes(resource)
  )
    notFound();
  const session = await requireWorkspace();
  if (
    !hasPermission(session, PERMISSIONS.crmView) ||
    !canViewCrmResource(session, resource)
  )
    notFound();
  const context = crmContext(session);
  const result = await tenantTransaction(
    context.organizationId,
    async (client) => ({
      records: await listCrmRecords(client, context, resource, {
        limit: 500,
        status: "all",
      }),
      options: await getCrmOptions(client, context),
    }),
  );
  const definition = crmDefinitions[resource];
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CRM · {definition.group}</p>
          <h1>{definition.title}</h1>
          <p>{definition.description}</p>
        </div>
        <span className="status-badge neutral">
          {session.companyName || "Organisation-wide"}
        </span>
      </section>
      <CrmResourceManager
        definition={definition}
        rows={JSON.parse(JSON.stringify(result.records.rows))}
        options={JSON.parse(JSON.stringify(result.options))}
        canManage={hasPermission(session, definition.permission)}
        startCreating={query.create === "1"}
        canImport={hasPermission(session, PERMISSIONS.crmImport)}
        canExport={hasPermission(session, PERMISSIONS.crmExport)}
      />
    </>
  );
}
