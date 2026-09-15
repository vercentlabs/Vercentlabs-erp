import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { requireWorkspace } from "@/core/session";
import { AccountFormScreen } from "@/features/crm/accounts/screens/AccountFormScreen";

export const metadata = { title: "New account" };

export default async function NewAccountPage() {
  const session = await requireWorkspace();
  const canManage = session.roleSlugs.includes("organization_owner") || session.permissions.includes(CRM_PERMISSIONS.accountsManage);
  return <AccountFormScreen mode="create" canManage={canManage} />;
}
