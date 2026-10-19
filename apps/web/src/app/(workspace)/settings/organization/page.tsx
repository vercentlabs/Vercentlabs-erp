import { hasSessionPermission } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/session";
import { CompanyScreen } from "@/features/settings/company/CompanyScreen";

export const metadata = { title: "Company" };

export default async function CompanySettingsPage() {
  const session = await requireWorkspace();
  return (
    <CompanyScreen
      canManage={hasSessionPermission(session, "organization.manage")}
      isOwner={session.roleSlugs.includes("organization_owner")}
    />
  );
}
