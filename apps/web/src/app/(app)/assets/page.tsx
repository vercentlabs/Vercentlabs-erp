import { getAssetsDashboard } from "@vercentlabs/api";

import AccessDenied from "@/shared/components/access-denied";
import AssetsDashboard from "@/modules/assets/components/assets-dashboard";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { assetsContext } from "@/modules/assets";

export const metadata = { title: "Assets" };
export const dynamic = "force-dynamic";

export default async function AssetsPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.assetsView)) {
    return <AccessDenied area="Assets" />;
  }
  const summary = await tenantTransaction(session.organizationId, (client) =>
    getAssetsDashboard(client, assetsContext(session)),
  );
  return <AssetsDashboard summary={summary} />;
}
