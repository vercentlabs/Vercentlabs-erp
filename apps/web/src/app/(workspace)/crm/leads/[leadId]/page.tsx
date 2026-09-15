import { requireWorkspace } from "@/core/session";
import { LeadDetailScreen } from "@/features/crm/leads/screens/LeadDetailScreen";

export const metadata = { title: "Lead" };

export default async function LeadDetailPage({ params }: { params: Promise<{ leadId: string }> }) {
  await requireWorkspace();
  const { leadId } = await params;
  return <LeadDetailScreen leadId={leadId} />;
}
