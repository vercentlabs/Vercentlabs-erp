import { requireWorkspace } from "@/core/session";
import { redirectWithQuery } from "@/shared/routing/redirect-with-query";

// A BOM's revision history is the Revisions tab of the BOM.
export default async function Page({ params, searchParams }: { params: Promise<{ bomId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireWorkspace();
  const { bomId } = await params;
  redirectWithQuery(`/manufacturing/boms/${bomId}`, await searchParams, { tab: "revisions" });
}
