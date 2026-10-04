import { requireWorkspace } from "@/core/session";
import { DuplicateRulesScreen } from "@/features/crm/duplicates/screens/DuplicateRulesScreen";

export const metadata = { title: "Duplicate Detection Rules" };

export default async function DuplicateRulesPage() {
  await requireWorkspace();
  return <DuplicateRulesScreen />;
}
