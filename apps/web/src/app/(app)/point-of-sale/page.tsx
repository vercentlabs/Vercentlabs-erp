import { getPointOfSaleDashboard } from "@vercentlabs/api";

import AccessDenied from "@/shared/components/access-denied";
import PointOfSaleDashboard from "@/modules/point-of-sale/components/point-of-sale-dashboard";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { pointOfSaleContext } from "@/modules/point-of-sale";

export const metadata = { title: "Point of Sale" };
export const dynamic = "force-dynamic";

export default async function PointOfSalePage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.posView)) {
    return <AccessDenied area="Point of Sale" />;
  }
  const summary = await tenantTransaction(session.organizationId, (client) =>
    getPointOfSaleDashboard(client, pointOfSaleContext(session)),
  );
  return <PointOfSaleDashboard summary={summary} />;
}
