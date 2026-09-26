import { hasSessionPermission } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { requireWorkspace } from "@/core/session";
import { FeatureConfigurationScreen } from "@/features/settings/configuration/screens/FeatureConfigurationScreen";

export const metadata = { title: "Feature configuration" };

export default async function FeatureConfigurationPage() {
  const session = await requireWorkspace();
  return <FeatureConfigurationScreen canManage={hasSessionPermission(session, CORE_PERMISSIONS.platformConfigurationManage)} />;
}
