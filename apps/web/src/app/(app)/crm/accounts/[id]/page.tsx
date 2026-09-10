import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCrmAccountForCaller } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import AccountDetailWorkspace from "@/modules/crm/components/account-detail-workspace";
import { crmApiContext } from "@/modules/crm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account" };

export default async function CrmAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();
  const context = await crmApiContext(session);
  const account = await tenantTransaction(context.organizationId, (client) =>
    getCrmAccountForCaller(client, context, id),
  ).catch(() => null);
  if (!account) notFound();

  return (
    <AccountDetailWorkspace
      account={JSON.parse(JSON.stringify(account))}
      canManage={hasPermission(session, PERMISSIONS.partiesManage)}
      canManageDuplicates={hasPermission(session, PERMISSIONS.crmAccountsManage)}
      editing={query.edit === "1"}
      currentUserId={session.userId}
    />
  );
}
