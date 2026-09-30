import { requireWorkspace } from "@/core/session";
import { OpportunityListScreen } from "@/features/crm/opportunities/screens/OpportunityListScreen";
import { PipelineBoardScreen } from "@/features/crm/pipeline/screens/PipelineBoardScreen";

export const metadata = { title: "Opportunities" };

// One Opportunities workspace with two views of the same records:
// ?view=list (default) and ?view=pipeline (the board). Each screen's own
// List / Pipeline toggle switches between them; /crm/pipeline redirects to
// the board view.
export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  await requireWorkspace();
  const { view } = await searchParams;
  return view === "pipeline" ? (
    <PipelineBoardScreen />
  ) : (
    <OpportunityListScreen />
  );
}
