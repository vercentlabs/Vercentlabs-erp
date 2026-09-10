import { CrmActivityWorkspacePage } from "@/modules/crm/seller-activity-and-follow-up-workspace/activity-workspace-page";

export const metadata = { title: "CRM inbox" };
export const dynamic = "force-dynamic";

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <CrmActivityWorkspacePage
      searchParams={searchParams}
      fixedType="email"
      basePath="/crm/inbox"
      pageTitle="Team inbox"
      pageDescription="Triage shared CRM conversations and keep communication history connected to customer records."
    />
  );
}
