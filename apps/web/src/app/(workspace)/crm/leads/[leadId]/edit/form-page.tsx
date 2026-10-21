import { requireWorkspace } from "@/core/session";
import { LeadFormScreen } from "@/features/crm/leads/screens/LeadFormScreen";

export const metadata = { title: "Edit lead" };

export default async function EditLeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  await requireWorkspace();
  return <LeadFormScreen leadId={(await params).leadId} />;
}
