import { getSupportDashboard } from "@vercentlabs/api";

import AccessDenied from "@/components/access-denied";
import SupportDashboard from "@/components/support/support-dashboard";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { supportContext } from "@/lib/support";

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
