import { CrmActivityWorkspacePage } from "@/modules/crm/seller-activity-and-follow-up-workspace/activity-workspace-page";

export const metadata = { title: "CRM meetings" };
export const dynamic = "force-dynamic";

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <CrmActivityWorkspacePage
      searchParams={searchParams}
      fixedType="meeting"
      basePath="/crm/meetings"
      pageTitle="Meetings"
      pageDescription="Schedule, run and complete customer meetings with calendar-aware follow-up."
    />
  );
}
