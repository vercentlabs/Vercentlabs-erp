import { hasSessionPermission } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { requireWorkspace } from "@/core/session";
import { AutomationsScreen } from "@/features/settings/automations/screens/AutomationsScreen";

export const metadata = { title: "Automations" };

export default async function AutomationsPage() {
  const session = await requireWorkspace();
  return <AutomationsScreen canManage={hasSessionPermission(session, CORE_PERMISSIONS.platformWorkflowsManage)} />;
}
