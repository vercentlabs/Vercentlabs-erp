import { requireWorkspace } from "@/core/session";
import { redirectWithQuery } from "@/shared/routing/redirect-with-query";

// One revision opens in the BOM with that revision selected (its recipe, editor, change log and actions).
export default async function Page({ params, searchParams }: { params: Promise<{ bomId: string; revisionId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireWorkspace();
  const { bomId, revisionId } = await params;
  redirectWithQuery(`/manufacturing/boms/${bomId}`, await searchParams, { revision: revisionId });
}
