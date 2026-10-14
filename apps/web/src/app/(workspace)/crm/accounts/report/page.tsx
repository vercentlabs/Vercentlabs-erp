import { requireWorkspace } from "@/core/session";
import { CrmReportsScreen } from "@/features/crm/reports/screens/CrmReportsScreen";

export const metadata = { title: "Reports" };

// The companies report is the Companies tab of Insights → Reports; its old address opens that tab.
export default async function AccountReportPage() {
  await requireWorkspace();
  return <CrmReportsScreen report="companies" />;
}
