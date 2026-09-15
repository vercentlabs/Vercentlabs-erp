import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { requireWorkspace } from "@/core/session";
import { MeetingFormScreen } from "@/features/crm/meetings/screens/MeetingFormScreen";

export const metadata = { title: "New meeting" };

export default async function NewMeetingPage() {
  const session = await requireWorkspace();
  const canManage = session.roleSlugs.includes("organization_owner") || session.permissions.includes(CRM_PERMISSIONS.activitiesManage);
  return <MeetingFormScreen canManage={canManage} />;
}
