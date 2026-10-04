import { requireWorkspace } from "@/core/session";
import { CrmReportsScreen } from "@/features/crm/reports/screens/CrmReportsScreen";

export const metadata = { title: "CRM Reports" };

export default async function CrmReportsPage({ searchParams }: { searchParams: Promise<{ report?: string | string[] }> }) {
  await requireWorkspace();
  const { report } = await searchParams;
  return <CrmReportsScreen report={typeof report === "string" ? report : null} />;
}
