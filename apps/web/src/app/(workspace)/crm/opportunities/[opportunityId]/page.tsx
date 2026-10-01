import { requireWorkspace } from "@/core/session";
import { OpportunityDetailScreen } from "@/features/crm/pipeline/opportunities/screens/OpportunityDetailScreen";

export const metadata = { title: "Opportunity" };

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ opportunityId: string }>;
}) {
  await requireWorkspace();
  const { opportunityId } = await params;
  return <OpportunityDetailScreen opportunityId={opportunityId} />;
}
