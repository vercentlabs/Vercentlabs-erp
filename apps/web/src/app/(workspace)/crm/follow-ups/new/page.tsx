import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { requireWorkspace } from "@/core/session";
import { FollowUpFormScreen } from "@/features/crm/follow-ups/screens/FollowUpFormScreen";

export const metadata = { title: "New follow-up" };

export default async function NewFollowUpPage() {
  const session = await requireWorkspace();
  const canManage = session.roleSlugs.includes("organization_owner") || session.permissions.includes(CRM_PERMISSIONS.activitiesManage);
  return <FollowUpFormScreen canManage={canManage} />;
}
