import { getCrmAccountForCaller } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { withClient } from "@/core/db";
import { requireWorkspace } from "@/core/session";
import { crmContext } from "@/features/crm/shared/crm-context";
import { AccountFormScreen } from "@/features/crm/accounts/screens/AccountFormScreen";
import type { Account } from "@/features/crm/accounts/types";

export const metadata = { title: "Edit account" };

export default async function EditAccountPage({ params }: { params: Promise<{ accountId: string }> }) {
  const session = await requireWorkspace();
  const canManage = session.roleSlugs.includes("organization_owner") || session.permissions.includes(CRM_PERMISSIONS.accountsManage);
  const { accountId } = await params;
  let account: Account | null = null;
  let notFound = false;
  if (canManage) {
    try {
      account = (await withClient((client) => getCrmAccountForCaller(client, crmContext(session), accountId))) as Account;
    } catch {
      notFound = true;
    }
  }
  return <AccountFormScreen mode="edit" account={account ?? undefined} canManage={canManage} notFound={notFound} />;
}
