import { getCrmRecord } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { requireWorkspace } from "@/core/session";
import { crmContext, loadRecordForEdit } from "@/features/crm/shared/crm-context";
import { LeadFormScreen } from "@/features/crm/leads/screens/LeadFormScreen";
import type { Lead } from "@/features/crm/leads/types";

export const metadata = { title: "Edit lead" };

// Never import @vercentlabs/design-system from a server component (see
// new/page.tsx's comment) — every not-found/closed/permission state is
// rendered by the client LeadFormScreen instead of here.
export default async function EditLeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  const session = await requireWorkspace();
  const canManage = session.roleSlugs.includes("organization_owner") || session.permissions.includes(CRM_PERMISSIONS.leadsManage);
  const { leadId } = await params;
  const loaded = canManage ? await loadRecordForEdit(session, (client) => getCrmRecord(client, crmContext(session), "leads", leadId)) : { record: null, notFound: false };
  const lead = loaded.record as Lead | null;
  const notFound = loaded.notFound;
  return <LeadFormScreen mode="edit" lead={lead ?? undefined} canManage={canManage} notFound={notFound} />;
}
