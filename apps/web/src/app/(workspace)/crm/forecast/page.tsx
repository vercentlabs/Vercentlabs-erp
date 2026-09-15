import { requireWorkspace } from "@/core/session";
import { CrmForecastScreen } from "@/features/crm/forecast/screens/CrmForecastScreen";

export const metadata = { title: "CRM Forecast" };

export default async function CrmForecastPage() {
  await requireWorkspace();
  return <CrmForecastScreen />;
}
