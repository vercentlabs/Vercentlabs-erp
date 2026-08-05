import { getAssetsDashboard } from "@vercentlabs/api";

import AccessDenied from "@/components/access-denied";
import AssetsDashboard from "@/components/assets/assets-dashboard";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { assetsContext } from "@/lib/assets";

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
