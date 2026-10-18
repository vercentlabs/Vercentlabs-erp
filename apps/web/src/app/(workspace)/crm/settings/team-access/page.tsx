import { requireWorkspace } from "@/core/session";
import { TeamAccessScreen } from "@/features/crm/settings/screens/TeamAccessScreen";

export const metadata = { title: "Team access" };

export default async function Page() {
  await requireWorkspace();
  return <TeamAccessScreen />;
}
