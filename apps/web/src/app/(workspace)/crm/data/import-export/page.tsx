import { requireWorkspace } from "@/core/session";
import { CrmImportExportScreen } from "@/features/crm/import-export/screens/CrmImportExportScreen";

export const metadata = { title: "Import & Export" };

export default async function CrmImportExportPage() {
  await requireWorkspace();
  return <CrmImportExportScreen />;
}
