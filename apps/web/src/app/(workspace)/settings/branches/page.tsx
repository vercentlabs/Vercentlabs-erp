import { hasSessionPermission } from "@vercentlabs/api";

import { requireWorkspace } from "@/core/session";
import { BranchesScreen } from "@/features/settings/branches/screens/BranchesScreen";

export const metadata = { title: "Branches" };

export default async function BranchesSettingsPage() {
  const session = await requireWorkspace();
  return <BranchesScreen canManage={hasSessionPermission(session, "branch.manage")} />;
}
