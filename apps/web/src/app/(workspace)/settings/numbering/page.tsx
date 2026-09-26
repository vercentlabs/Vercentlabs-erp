import { hasSessionPermission } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { requireWorkspace } from "@/core/session";
import { NumberingScreen } from "@/features/settings/numbering/screens/NumberingScreen";

export const metadata = { title: "Numbering" };

export default async function NumberingPage() {
  const session = await requireWorkspace();
  return <NumberingScreen canManage={hasSessionPermission(session, CORE_PERMISSIONS.numberingManage)} />;
}
