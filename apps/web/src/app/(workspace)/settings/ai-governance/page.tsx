import { hasSessionPermission } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { requireWorkspace } from "@/core/session";
import { AiGovernanceScreen } from "@/features/settings/ai-governance/screens/AiGovernanceScreen";

export const metadata = { title: "AI governance" };

export default async function AiGovernancePage() {
  const session = await requireWorkspace();
  return <AiGovernanceScreen canManage={hasSessionPermission(session, CORE_PERMISSIONS.platformAiManage)} />;
}
