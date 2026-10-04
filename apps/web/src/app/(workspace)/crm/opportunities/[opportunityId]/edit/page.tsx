import { requireWorkspace } from "@/core/session";
import { OpportunityFormScreen } from "@/features/crm/opportunities/screens/OpportunityFormScreen";

export const metadata = { title: "Edit opportunity" };

export default async function Page({ params }: { params: Promise<{ opportunityId: string }> }) {
  await requireWorkspace();
  const { opportunityId } = await params;
  return <OpportunityFormScreen opportunityId={opportunityId} />;
}
