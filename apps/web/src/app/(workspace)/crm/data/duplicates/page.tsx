import { requireWorkspace } from "@/core/session";
import { DuplicatesWorkspaceScreen } from "@/features/crm/data/duplicates/screens/DuplicatesWorkspaceScreen";

export const metadata = { title: "Duplicate Management" };

export default async function CrmDuplicatesPage() {
  await requireWorkspace();
  return <DuplicatesWorkspaceScreen />;
}
