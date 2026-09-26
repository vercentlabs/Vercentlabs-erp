import { hasSessionPermission } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";
import { Suspense } from "react";

import { requireWorkspace } from "@/core/session";
import { IntegrationsScreen } from "@/features/settings/integrations/screens/IntegrationsScreen";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const session = await requireWorkspace();
  return (
    <Suspense>
      <IntegrationsScreen canView={hasSessionPermission(session, CORE_PERMISSIONS.integrationsView)} canManage={hasSessionPermission(session, CORE_PERMISSIONS.integrationsManage)} />
    </Suspense>
  );
}
