import { requireWorkspace } from "@/core/session";
import { LeadDetailScreen } from "@/features/crm/leads/screens/LeadDetailScreen";

export const metadata = { title: "Lead" };

export default async function LeadPage({ params }: { params: Promise<{ leadId: string }> }) {
  await requireWorkspace();
  return <LeadDetailScreen leadId={(await params).leadId} />;
}
