import { getPointOfSaleDashboard } from "@vercentlabs/api";

import AccessDenied from "@/components/access-denied";
import PointOfSaleDashboard from "@/components/point-of-sale/point-of-sale-dashboard";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { pointOfSaleContext } from "@/lib/point-of-sale";

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
