import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCrmDashboard, getCrmOptions, listCrmRecords } from "@vercentlabs/api";
import CrmResourceManager from "@/modules/crm/components/resource-manager";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { crmContext, crmDefinitions, isCrmDefinition } from "@/modules/crm";
import { canViewCrmResource } from "@/modules/crm/api";
import { tenantTransaction } from "@/core/db";
export const dynamic = "force-dynamic";
const PAGE_SIZE = 10;
const LEAD_PRIORITIES = ["all", "low", "medium", "high", "urgent"] as const;
const LEAD_RATINGS = ["all", "cold", "warm", "hot"] as const;
const LEAD_FOLLOWUPS = ["all", "none", "overdue", "today", "upcoming"] as const;

function enumFilter<const T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
  fallback: T[number],
): T[number] {
  const normalized = String(value || fallback).trim().slice(0, 40);
  return allowed.includes(normalized as T[number])
    ? (normalized as T[number])
    : fallback;
}

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
    ownerId?: string;
    sourceId?: string;
    priority?: string;
    rating?: string;
    followup?: string;
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
  const ownerId = String(query.ownerId || "").trim().slice(0, 80);
  const sourceId = String(query.sourceId || "").trim().slice(0, 80);
  const priority = enumFilter(query.priority, LEAD_PRIORITIES, "all");
  const rating = enumFilter(query.rating, LEAD_RATINGS, "all");
  const followup = enumFilter(query.followup, LEAD_FOLLOWUPS, "all");
  const pageSize = resource === "leads" ? 50 : PAGE_SIZE;
  const result = await tenantTransaction(
    context.organizationId,
    async (client) => ({
      records: await listCrmRecords(client, context, resource, {
        limit: pageSize,
        offset: (page - 1) * pageSize,
        search,
        status,
        ownerId: resource === "leads" ? ownerId : undefined,
        sourceId: resource === "leads" ? sourceId : undefined,
        priority: resource === "leads" ? priority : undefined,
        rating: resource === "leads" ? rating : undefined,
        followup: resource === "leads" ? followup : undefined,
      }),
      options: await getCrmOptions(client, context),
      leadDashboard:
        resource === "leads" ? await getCrmDashboard(client, context) : null,
      leadBoard:
        resource === "leads"
          ? await listCrmRecords(client, context, "leads", {
              limit: 500,
              offset: 0,
              search,
              status,
              ownerId,
              sourceId,
              priority,
              rating,
              followup,
            })
          : null,
    }),
  );
  const totalPages = Math.max(1, Math.ceil(result.records.total / pageSize));
  if (page > totalPages)
    redirect(pageUrl(resource, totalPages, search, status));
  const definition = crmDefinitions[resource];
  const canManage = hasPermission(session, definition.permission);
  const dedicatedLeadWorkspace = resource === "leads";
  const dedicatedLeadCreate =
    dedicatedLeadWorkspace && query.create === "1" && canManage;
  return (
    <>
      {!dedicatedLeadWorkspace ? (
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
      ) : null}
      <CrmResourceManager
        key={`${resource}:${search}:${status}`}
        definition={definition}
        rows={JSON.parse(JSON.stringify(result.records.rows))}
        total={result.records.total}
        page={page}
        pageSize={pageSize}
        initialSearch={search}
        initialStatus={status}
        options={JSON.parse(JSON.stringify(result.options))}
        canManage={canManage}
        startCreating={dedicatedLeadCreate}
        canImport={hasPermission(session, PERMISSIONS.crmImport)}
        canExport={hasPermission(session, PERMISSIONS.crmExport)}
        leadDashboard={JSON.parse(JSON.stringify(result.leadDashboard))}
        leadFilters={{ ownerId, sourceId, priority, rating, followup }}
        leadBoardRows={JSON.parse(JSON.stringify(result.leadBoard?.rows || []))}
      />
    </>
  );
}
