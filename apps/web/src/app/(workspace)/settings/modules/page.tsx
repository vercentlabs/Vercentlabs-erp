import { hasSessionPermission } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { requireWorkspace } from "@/core/session";
import { ModulesScreen } from "@/features/settings/modules/screens/ModulesScreen";

export const metadata = { title: "Modules" };

export default async function ModulesSettingsPage() {
  const session = await requireWorkspace();
  return <ModulesScreen canManage={hasSessionPermission(session, CORE_PERMISSIONS.modulesManage)} />;
}
