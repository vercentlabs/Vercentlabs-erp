import { CrmActivityWorkspacePage } from "@/modules/crm/seller-activity-and-follow-up-workspace/activity-workspace-page";

export const metadata = { title: "CRM calls" };
export const dynamic = "force-dynamic";

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <CrmActivityWorkspacePage
      searchParams={searchParams}
      fixedType="call"
      basePath="/crm/calls"
      pageTitle="Calls"
      pageDescription="Plan, log and complete seller calls from one focused workspace."
    />
  );
}
