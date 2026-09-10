import { CrmActivityWorkspacePage } from "@/modules/crm/seller-activity-and-follow-up-workspace/activity-workspace-page";

export const metadata = { title: "CRM follow-ups" };
export const dynamic = "force-dynamic";

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <CrmActivityWorkspacePage
      searchParams={searchParams}
      fixedType="follow_up"
      basePath="/crm/follow-ups"
      pageTitle="Follow-ups"
      pageDescription="Manage scheduled follow-ups, reminders and escalation without losing record context."
    />
  );
}
