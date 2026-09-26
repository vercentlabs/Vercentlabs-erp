import { hasSessionPermission } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { requireWorkspace } from "@/core/session";
import { AuditScreen } from "@/features/settings/audit/screens/AuditScreen";

export const metadata = { title: "Audit" };

export default async function AuditPage() {
  const session = await requireWorkspace();
  return <AuditScreen canView={hasSessionPermission(session, CORE_PERMISSIONS.auditView)} />;
}
