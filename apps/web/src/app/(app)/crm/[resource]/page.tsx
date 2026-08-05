import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCrmOptions, listCrmRecords } from "@vercentlabs/api";
import CrmResourceManager from "@/components/crm-resource-manager";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext, crmDefinitions, isCrmDefinition } from "@/lib/crm";
import { canViewCrmResource } from "@/lib/crm-api";
import { tenantTransaction } from "@/lib/db";
export const dynamic = "force-dynamic";
const PAGE_SIZE = 10;

function pageUrl(
  resource: string,
  page: number,
  search: string,
  status: string,
) {
  const query = new URLSearchParams();
  if (search) query.set("search", search);
  if (status !== "all") query.set("status", status);
  if (page > 1) query.set("page", String(page));
  const suffix = query.toString();
  return `/crm/${resource}${suffix ? `?${suffix}` : ""}`;
}
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
  searchParams: Promise<{
    create?: string;
    page?: string;
    search?: string;
    status?: string;
  }>;
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
  const parsedPage = Math.trunc(Number(query.page) || 1);
  const page = Math.min(1_000_000, Math.max(1, parsedPage));
  const search = String(query.search || "")
    .trim()
    .slice(0, 200);
  const status =
    String(query.status || "all")
      .trim()
      .slice(0, 80) || "all";
  const result = await tenantTransaction(
    context.organizationId,
    async (client) => ({
      records: await listCrmRecords(client, context, resource, {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        search,
        status,
      }),
      options: await getCrmOptions(client, context),
    }),
  );
  const totalPages = Math.max(1, Math.ceil(result.records.total / PAGE_SIZE));
  if (page > totalPages)
    redirect(pageUrl(resource, totalPages, search, status));
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
        key={`${resource}:${search}:${status}`}
        definition={definition}
        rows={JSON.parse(JSON.stringify(result.records.rows))}
        total={result.records.total}
        page={page}
        pageSize={PAGE_SIZE}
        initialSearch={search}
        initialStatus={status}
        options={JSON.parse(JSON.stringify(result.options))}
        canManage={hasPermission(session, definition.permission)}
        startCreating={query.create === "1"}
        canImport={hasPermission(session, PERMISSIONS.crmImport)}
        canExport={hasPermission(session, PERMISSIONS.crmExport)}
      />
    </>
  );
}
