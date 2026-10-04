import { requireWorkspace } from "@/core/session";
import { DataQualityScreen } from "@/features/crm/duplicates/screens/DataQualityScreen";

export const metadata = { title: "Data Quality" };

export default async function DataQualityPage() {
  await requireWorkspace();
  return <DataQualityScreen />;
}
