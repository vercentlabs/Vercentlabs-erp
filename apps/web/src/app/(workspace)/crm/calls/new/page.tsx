import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { requireWorkspace } from "@/core/session";
import { CallFormScreen } from "@/features/crm/calls/screens/CallFormScreen";

export const metadata = { title: "New call" };

export default async function NewCallPage() {
  const session = await requireWorkspace();
  const canManage = session.roleSlugs.includes("organization_owner") || session.permissions.includes(CRM_PERMISSIONS.activitiesManage);
  return <CallFormScreen canManage={canManage} />;
}
