import { getSupportDashboard } from "@vercentlabs/api";

import AccessDenied from "@/shared/components/access-denied";
import SupportDashboard from "@/modules/support/components/support-dashboard";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { supportContext } from "@/modules/support";

export const metadata = { title: "Support" };
export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.supportView)) {
    return <AccessDenied area="Support" />;
  }

  const summary = await tenantTransaction(session.organizationId, (client) =>
    getSupportDashboard(client, supportContext(session)),
  );

  return <SupportDashboard summary={summary} />;
}
