import { requireWorkspace } from "@/core/session";
import { HistoryImportScreen } from "@/features/crm/settings/screens/HistoryImportScreen";

export const metadata = { title: "Past notes and activities" };

export default async function Page() {
  await requireWorkspace();
  return <HistoryImportScreen />;
}
