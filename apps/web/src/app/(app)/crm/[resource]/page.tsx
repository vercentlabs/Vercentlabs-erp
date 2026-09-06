import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCrmOptions, getCrmRecord, listCrmRecords } from "@vercentlabs/api";
import CrmResourceManager from "@/modules/crm/components/resource-manager";
import { PageHeader, StatusBadge } from "@/shared/design";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { crmContext, crmDefinitions, isCrmDefinition } from "@/modules/crm";
import { canViewCrmResource } from "@/modules/crm/api";
import { isCrmUiResource } from "@/modules/crm/scope";
import { getLeadDetailData } from "@/modules/crm/server/lead-detail-data";
import { enrichLeadOwnerIdentity } from "@/modules/crm/server/lead-owner-data";
import { tenantTransaction } from "@/core/db";
export const dynamic = "force-dynamic";
const PAGE_SIZE = 10;
const LEAD_PRIORITIES = ["all", "low", "medium", "high", "urgent"] as const;
const LEAD_RATINGS = ["all", "cold", "warm", "hot"] as const;
const LEAD_FOLLOWUPS = ["all", "none", "overdue", "today", "upcoming"] as const;
const LEAD_QUALIFICATIONS = [
  "all",
  "not_reviewed",
  "qualified",
  "unqualified",
] as const;

function enumFilter<const T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
  fallback: T[number],
): T[number] {
  const normalized = String(value || fallback)
    .trim()
    .slice(0, 40);
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
    qualification?: string;
    edit?: string;
    view?: string;
  }>;
}) {
  const [{ resource }, query] = await Promise.all([params, searchParams]);
  if (!isCrmDefinition(resource) || !isCrmUiResource(resource)) notFound();
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
  const ownerId = String(query.ownerId || "")
    .trim()
    .slice(0, 80);
  const sourceId = String(query.sourceId || "")
    .trim()
    .slice(0, 80);
  const priority = enumFilter(query.priority, LEAD_PRIORITIES, "all");
  const rating = enumFilter(query.rating, LEAD_RATINGS, "all");
  const followup = enumFilter(query.followup, LEAD_FOLLOWUPS, "all");
  const qualification = enumFilter(
    query.qualification,
    LEAD_QUALIFICATIONS,
    "all",
  );
  const editId = String(query.edit || "")
    .trim()
    .slice(0, 80);
  const viewId = String(query.view || "")
    .trim()
    .slice(0, 80);
  const pageSize = resource === "leads" ? 50 : PAGE_SIZE;
  const definition = crmDefinitions[resource];
  const canManage = hasPermission(session, definition.permission);
  const result = await tenantTransaction(
    context.organizationId,
    async (client) => {
      const records = await listCrmRecords(client, context, resource, {
        limit: pageSize,
        offset: (page - 1) * pageSize,
        search,
        status,
        ownerId: resource === "leads" ? ownerId : undefined,
        sourceId: resource === "leads" ? sourceId : undefined,
        priority: resource === "leads" ? priority : undefined,
        rating: resource === "leads" ? rating : undefined,
        followup: resource === "leads" ? followup : undefined,
        qualification: resource === "leads" ? qualification : undefined,
      });
      if (resource === "leads")
        records.rows = await enrichLeadOwnerIdentity(
          client,
          context.organizationId,
          records.rows,
        );
      const leadBoard =
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
              qualification,
            })
          : null;
      if (leadBoard)
        leadBoard.rows = await enrichLeadOwnerIdentity(
          client,
          context.organizationId,
          leadBoard.rows,
        );
      return {
        records,
        options: await getCrmOptions(client, context),
        leadBoard,
        editingRecord:
          editId && canManage
            ? await getCrmRecord(client, context, resource, editId).catch(
                () => null,
              )
            : null,
        leadDetail:
          resource === "leads" && viewId
            ? await getLeadDetailData(client, context, viewId).catch(() => null)
            : null,
      };
    },
  );
  const totalPages = Math.max(1, Math.ceil(result.records.total / pageSize));
  if (page > totalPages)
    redirect(pageUrl(resource, totalPages, search, status));
  const dedicatedLeadWorkspace = resource === "leads";
  const dedicatedLeadCreate =
    dedicatedLeadWorkspace && query.create === "1" && canManage;
  return (
    <>
      {!dedicatedLeadWorkspace ? (
        <PageHeader
          eyebrow={`CRM · ${definition.group}`}
          title={definition.title}
          description={definition.description}
          context={
            <StatusBadge tone="neutral">
              {session.companyName || "Organisation-wide"}
            </StatusBadge>
          }
        />
      ) : null}
      <CrmResourceManager
        key={[
          resource,
          page,
          search,
          status,
          ownerId,
          sourceId,
          priority,
          rating,
          followup,
          qualification,
        ].join(":")}
        definition={definition}
        rows={JSON.parse(JSON.stringify(result.records.rows))}
        total={result.records.total}
        page={page}
        pageSize={pageSize}
        initialSearch={search}
        initialStatus={status}
        options={JSON.parse(JSON.stringify(result.options))}
        canManage={canManage}
        canAssignOwner={
          hasPermission(session, PERMISSIONS.crmRecordsViewAll) ||
          session.roleSlugs.includes("organization_owner")
        }
        canShareSavedViews={hasPermission(session, PERMISSIONS.crmSavedViewsShare)}
        canShareOrganizationViews={
          hasPermission(session, PERMISSIONS.crmSavedViewsShare) &&
          (hasPermission(session, PERMISSIONS.crmRecordsViewAll) ||
            session.roleSlugs.includes("organization_owner"))
        }
        startCreating={dedicatedLeadCreate}
        startEditing={JSON.parse(JSON.stringify(result.editingRecord))}
        startViewingLead={JSON.parse(JSON.stringify(result.leadDetail))}
        canImport={
          resource === "leads" && hasPermission(session, PERMISSIONS.crmImport)
        }
        canExport={
          resource === "leads" && hasPermission(session, PERMISSIONS.crmExport)
        }
        leadFilters={{
          ownerId,
          sourceId,
          priority,
          rating,
          followup,
          qualification,
        }}
        leadBoardRows={JSON.parse(JSON.stringify(result.leadBoard?.rows || []))}
        leadBoardTotal={Number(result.leadBoard?.total || 0)}
        canManageActivities={hasPermission(
          session,
          PERMISSIONS.crmActivitiesManage,
        )}
        canManageCommunications={hasPermission(
          session,
          PERMISSIONS.crmCommunicationsManage,
        )}
        canManagePrivacy={hasPermission(session, PERMISSIONS.crmPrivacyManage)}
        canManageDataQuality={hasPermission(
          session,
          PERMISSIONS.crmDataQualityManage,
        )}
      />
    </>
  );
}
