import { requireWorkspace } from "@/core/session";
import { redirectWithQuery } from "@/shared/routing/redirect-with-query";

// A tab of Inventory Journals: this list address keeps working (bookmarks, ?itemId= drill-downs) and opens that tab with its query intact.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireWorkspace();
  redirectWithQuery("/inventory/journals", await searchParams, { tab: "adjustments" });
}
