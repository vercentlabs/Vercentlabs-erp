import { CrmActivityWorkspacePage } from "@/modules/crm/seller-activity-and-follow-up-workspace/activity-workspace-page";

export const metadata = { title: "CRM my work" };
export const dynamic = "force-dynamic";

export default function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return (
    <CrmActivityWorkspacePage
      searchParams={searchParams}
      basePath="/crm/work"
      pageTitle="My work"
      pageDescription="Work calls, meetings, tasks, scheduled follow-ups and customer conversations from one queue."
    />
  );
}
