import { CrmActivityWorkspacePage } from "@/modules/crm/seller-activity-and-follow-up-workspace/activity-workspace-page";

export const metadata = { title: "CRM tasks" };
export const dynamic = "force-dynamic";

export default function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <CrmActivityWorkspacePage
      searchParams={searchParams}
      fixedType="task"
      basePath="/crm/tasks"
      pageTitle="Tasks"
      pageDescription="Work your assigned tasks, team queue, due dates, recurrence and dependencies."
    />
  );
}
