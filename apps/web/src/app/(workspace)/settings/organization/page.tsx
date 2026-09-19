import { hasSessionPermission } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/session";
import { OrganizationProfileScreen } from "@/features/settings/organization/screens/OrganizationProfileScreen";

export const metadata = { title: "Organization" };

export default async function OrganizationSettingsPage() {
  const session = await requireWorkspace();
  return <OrganizationProfileScreen canManage={hasSessionPermission(session, "organization.manage")} />;
}
