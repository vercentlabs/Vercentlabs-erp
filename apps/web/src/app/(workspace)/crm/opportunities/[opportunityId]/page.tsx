import { requireWorkspace } from "@/core/session";
import { OpportunityDetailScreen } from "@/features/crm/opportunities/screens/OpportunityDetailScreen";

export const metadata = { title: "Deal" };

export default async function Page({ params }: { params: Promise<{ opportunityId: string }> }) {
  await requireWorkspace();
  const { opportunityId } = await params;
  return <OpportunityDetailScreen opportunityId={opportunityId} />;
}
