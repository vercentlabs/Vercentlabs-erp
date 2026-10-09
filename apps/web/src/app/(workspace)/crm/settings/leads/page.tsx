import { requireWorkspace } from "@/core/session";
import { WorkspaceHubScreen } from "@/shell/navigation/WorkspaceHubScreen";

export const metadata = { title: "Lead Setup" };

// CRM › Configuration › Lead Setup: every configuration page registered under it, as cards. ?section=<group> scrolls to a group.
export default async function Page({ searchParams }: { searchParams: Promise<{ section?: string | string[] }> }) {
  await requireWorkspace();
  const { section } = await searchParams;
  return <WorkspaceHubScreen moduleKey="crm" workspace="lead-setup" title="Lead Setup" description="Lead stages and statuses, qualification criteria, lead sources, activity defaults and lead imports." section={typeof section === "string" ? section : null} />;
}
