import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { listCrmAccounts } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import AccountsWorkspace from "@/modules/crm/components/accounts-workspace";
import { crmApiContext } from "@/modules/crm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Accounts" };

export default async function CrmAccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();
  const context = await crmApiContext(session);
  const page = Math.max(1, Math.trunc(Number(query.page) || 1));
  const pageSize = 25;
  const search = String(query.search || "")
    .trim()
    .slice(0, 200);
  const requestedStatus = String(query.status || "active");
  const status: "active" | "inactive" | "all" = [
    "active",
    "inactive",
    "all",
  ].includes(requestedStatus)
    ? (requestedStatus as "active" | "inactive" | "all")
    : "active";
  const industry = String(query.industry || "")
    .trim()
    .slice(0, 160);
  const country = String(query.country || "")
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const result = await tenantTransaction(context.organizationId, (client) =>
    listCrmAccounts(client, context, {
      search,
      status,
      industry,
      country,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    }),
  );
  const totalPages = Math.max(1, Math.ceil(result.total / pageSize));
  if (page > totalPages) redirect("/crm/accounts");

  return (
    <AccountsWorkspace
      rows={JSON.parse(JSON.stringify(result.rows))}
      total={result.total}
      page={page}
      pageSize={pageSize}
      search={search}
      status={status}
      industry={industry}
      country={country}
      filters={result.filters}
      canManage={hasPermission(session, PERMISSIONS.partiesManage)}
      creating={query.create === "1"}
    />
  );
}
