import { hasSessionPermission } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/session";
import { RolesScreen } from "@/features/settings/roles/screens/RolesScreen";

export const metadata = { title: "Roles and permissions" };

export default async function RolesSettingsPage() {
  const session = await requireWorkspace();
  return <RolesScreen canManage={hasSessionPermission(session, "roles.view")} canEdit={hasSessionPermission(session, "roles.manage")} />;
}
