import { requireWorkspace } from "@/core/session";
import { redirectWithQuery } from "@/shared/routing/redirect-with-query";

// A tab of CRM Activities: this address keeps working (bookmarks, back links, ?view= drill-downs) and opens that tab with its query intact.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireWorkspace();
  redirectWithQuery("/crm/activities", await searchParams, { tab: "follow-ups" });
}
