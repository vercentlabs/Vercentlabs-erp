import { getQualityDashboard } from "@vercentlabs/api";

import AccessDenied from "@/components/access-denied";
import QualityDashboard from "@/components/quality/quality-dashboard";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { tenantTransaction } from "@/lib/db";
import { qualityContext } from "@/lib/quality";

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
