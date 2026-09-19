import { hasSessionPermission } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/session";
import { CompaniesScreen } from "@/features/settings/companies/screens/CompaniesScreen";

export const metadata = { title: "Companies" };

export default async function CompaniesSettingsPage() {
  const session = await requireWorkspace();
  return <CompaniesScreen canManage={hasSessionPermission(session, "company.manage")} />;
}
