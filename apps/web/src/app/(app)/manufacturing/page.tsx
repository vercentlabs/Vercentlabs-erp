import { getManufacturingDashboard } from "@vercentlabs/api";

import AccessDenied from "@/components/access-denied";
import ManufacturingDashboard from "@/components/manufacturing/manufacturing-dashboard";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { manufacturingContext } from "@/lib/manufacturing";

export const metadata = { title: "Manufacturing" };
export const dynamic = "force-dynamic";

export default async function ManufacturingPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.manufacturingView)) {
    return <AccessDenied area="Manufacturing" />;
  }

  const summary = await tenantTransaction(session.organizationId, (client) =>
    getManufacturingDashboard(client, manufacturingContext(session)),
  );

  return <ManufacturingDashboard summary={summary} />;
}
