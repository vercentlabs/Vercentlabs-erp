import { notFound } from "next/navigation";
import { getCrmLeadSource, listCrmLeadSources } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import LeadSourcesWorkspace from "@/modules/crm/components/lead-sources-workspace";
import { crmApiContext } from "@/modules/crm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lead sources" };

const text = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] || "" : value || "";

export default async function LeadSourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireWorkspace();
  if (
    !hasPermission(session, PERMISSIONS.crmView) ||
    !hasPermission(session, PERMISSIONS.crmSettingsManage)
  )
    notFound();
  const query = await searchParams;
  const search = text(query.search).trim().slice(0, 200);
  const requestedStatus = text(query.status) || "active";
  const status = ["active", "inactive", "all"].includes(requestedStatus)
    ? requestedStatus
    : "active";
  const page = Math.max(1, Number.parseInt(text(query.page) || "1", 10) || 1);
  const pageSize = 25;
  const editId = text(query.edit).trim();
  const context = await crmApiContext(session);
  const data = await tenantTransaction(
    context.organizationId,
    async (client) => ({
      sources: await listCrmLeadSources(client, context, {
        search,
        status,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
      editing: editId
        ? await getCrmLeadSource(client, context, editId).catch(() => null)
        : null,
    }),
  );
  return (
    <LeadSourcesWorkspace
      rows={JSON.parse(JSON.stringify(data.sources.rows))}
      total={data.sources.total}
      page={page}
      pageSize={pageSize}
      search={search}
      status={status}
      create={text(query.create) === "1"}
      editing={JSON.parse(JSON.stringify(data.editing))}
    />
  );
}
