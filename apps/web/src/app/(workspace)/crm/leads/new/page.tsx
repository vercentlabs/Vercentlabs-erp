import { CRM_PERMISSIONS } from "@vercentlabs/permissions";
import { requireWorkspace } from "@/core/session";
import { LeadFormScreen } from "@/features/crm/leads/screens/LeadFormScreen";

export const metadata = { title: "New lead" };

// Never import @vercentlabs/design-system from a server component: several
// of its files use hooks without a "use client" directive of their own,
// relying on always being reached through an already-client boundary —
// importing the barrel here breaks the build ("You're importing a module
// that depends on useState/useEffect/useRef into a Server Component").
// Permission gating renders inside the client LeadFormScreen instead.
export default async function NewLeadPage() {
  const session = await requireWorkspace();
  const canManage = session.roleSlugs.includes("organization_owner") || session.permissions.includes(CRM_PERMISSIONS.leadsManage);
  return <LeadFormScreen mode="create" canManage={canManage} />;
}
