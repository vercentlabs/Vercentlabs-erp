import { requireWorkspace } from "@/core/session";
import { isActivityTab } from "@/features/crm/activities/activity-tabs";
import { redirectWithQuery } from "@/shared/routing/redirect-with-query";

// The earlier My Work workspace is CRM Activities: ?view=<tab> becomes ?tab=<tab>, the rest of the query is kept.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireWorkspace();
  const params = await searchParams;
  redirectWithQuery("/crm/activities", params, { view: undefined, tab: isActivityTab(params.view) ? String(params.view) : "today" });
}
