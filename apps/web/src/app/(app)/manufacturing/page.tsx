import { getManufacturingDashboard } from "@vercentlabs/api";

import AccessDenied from "@/shared/components/access-denied";
import ManufacturingDashboard from "@/modules/manufacturing/components/manufacturing-dashboard";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { manufacturingContext } from "@/modules/manufacturing";

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
