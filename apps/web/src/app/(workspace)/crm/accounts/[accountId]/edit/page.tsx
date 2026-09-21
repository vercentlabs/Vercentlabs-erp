import { getCrmAccountForCaller } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { requireWorkspace } from "@/core/session";
import { crmContext, loadRecordForEdit } from "@/features/crm/shared/crm-context";
import { AccountFormScreen } from "@/features/crm/accounts/screens/AccountFormScreen";
import type { Account } from "@/features/crm/accounts/types";

export const metadata = { title: "Edit account" };

export default async function EditAccountPage({ params }: { params: Promise<{ accountId: string }> }) {
  const session = await requireWorkspace();
  const canManage = session.roleSlugs.includes("organization_owner") || session.permissions.includes(CRM_PERMISSIONS.accountsManage);
  const { accountId } = await params;
  const loaded = canManage ? await loadRecordForEdit(session, (client) => getCrmAccountForCaller(client, crmContext(session), accountId)) : { record: null, notFound: false };
  const account = loaded.record as Account | null;
  const notFound = loaded.notFound;
  return <AccountFormScreen mode="edit" account={account ?? undefined} canManage={canManage} notFound={notFound} />;
}
