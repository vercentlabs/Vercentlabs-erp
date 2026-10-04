import { requireWorkspace } from "@/core/session";
import { OpportunityFormScreen } from "@/features/crm/opportunities/screens/OpportunityFormScreen";

export const metadata = { title: "New opportunity" };

// ?accountId= preselects the account when opened from an account.
export default async function Page({ searchParams }: { searchParams: Promise<{ accountId?: string }> }) {
  await requireWorkspace();
  const { accountId } = await searchParams;
  return <OpportunityFormScreen initialAccountId={typeof accountId === "string" ? accountId : undefined} />;
}
