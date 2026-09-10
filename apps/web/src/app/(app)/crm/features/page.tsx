import { notFound } from "next/navigation";

import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import CrmFeatureDirectory from "@/modules/crm/ui/crm-feature-directory";
import { CRM_FEATURE_SURFACES } from "@/modules/crm/ui/crm-surface-registry";

export const metadata = { title: "All CRM features" };

export default async function CrmFeaturesPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) notFound();
  const accessibleFeatureIds = CRM_FEATURE_SURFACES
    .filter((feature) => hasPermission(session, feature.permission))
    .map((feature) => feature.id);
  return <CrmFeatureDirectory accessibleFeatureIds={accessibleFeatureIds} />;
}
