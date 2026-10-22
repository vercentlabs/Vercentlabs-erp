import { requireWorkspace } from "@/core/session";
import { TeamsSettingsScreen } from "@/features/settings/teams/screens/TeamsSettingsScreen";

export const metadata = { title: "Teams" };

export default async function Page() {
  await requireWorkspace();
  return <TeamsSettingsScreen />;
}
