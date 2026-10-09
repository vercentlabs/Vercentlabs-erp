import { requireWorkspace } from "@/core/session";
import { WorkspaceHubScreen } from "@/shell/navigation/WorkspaceHubScreen";

export const metadata = { title: "Opportunity Setup" };

// CRM › Configuration › Opportunity Setup: every configuration page registered under it, as cards. ?section=<group> scrolls to a group.
export default async function Page({ searchParams }: { searchParams: Promise<{ section?: string | string[] }> }) {
  await requireWorkspace();
  const { section } = await searchParams;
  return <WorkspaceHubScreen moduleKey="crm" workspace="opportunity-setup" title="Opportunity Setup" description="The sales stages of the pipeline and the reasons deals are won or lost." section={typeof section === "string" ? section : null} />;
}
