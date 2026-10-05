import { requireWorkspace } from "@/core/session";
import { TeamsSettingsScreen } from "@/features/settings/teams/screens/TeamsSettingsScreen";

export const metadata = { title: "Teams" };

export default async function TeamsSettingsPage() {
  await requireWorkspace();
  return <TeamsSettingsScreen />;
}
