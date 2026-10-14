import { requireWorkspace } from "@/core/session";
import { ImportDataScreen } from "@/features/crm/shared/ImportDataScreen";

export const metadata = { title: "Import data" };

// The leads import, opened in Import data with the type already chosen.
export default async function Page() {
  await requireWorkspace();
  return <ImportDataScreen initial="leads" />;
}
