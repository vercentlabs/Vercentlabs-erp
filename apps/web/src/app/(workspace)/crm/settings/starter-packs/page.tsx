import { requireWorkspace } from "@/core/session";
import { StarterPacksScreen } from "@/features/crm/settings/screens/StarterPacksScreen";

export const metadata = { title: "Industry starter packs" };

export default async function Page() {
  await requireWorkspace();
  return <StarterPacksScreen />;
}
