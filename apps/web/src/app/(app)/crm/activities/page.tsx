import { CrmActivityWorkspacePage } from "@/modules/crm/seller-activity-and-follow-up-workspace/activity-workspace-page";

export const metadata = { title: "CRM activities" };
export const dynamic = "force-dynamic";

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <CrmActivityWorkspacePage
      searchParams={searchParams}
      basePath="/crm/activities"
      pageTitle="Activities"
      pageDescription="One work queue for calls, meetings, tasks, follow-ups and the shared team inbox."
    />
  );
}
