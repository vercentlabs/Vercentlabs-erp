import { getQualityDashboard } from "@vercentlabs/api";

import AccessDenied from "@/shared/components/access-denied";
import QualityDashboard from "@/modules/quality/components/quality-dashboard";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { qualityContext } from "@/modules/quality";

export const metadata = { title: "Quality" };
export const dynamic = "force-dynamic";

export default async function QualityPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.qualityView)) {
    return <AccessDenied area="Quality" />;
  }

  const summary = await tenantTransaction(session.organizationId, (client) =>
    getQualityDashboard(client, qualityContext(session)),
  );

  return <QualityDashboard summary={summary} />;
}
