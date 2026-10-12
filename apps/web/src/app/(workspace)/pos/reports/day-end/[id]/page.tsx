import { requireWorkspace } from "@/core/session";
import { redirectWithQuery } from "@/shared/routing/redirect-with-query";

// A Z report's address is /pos/day-end/z-reports/<id> now. This address keeps working for bookmarks and links.
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireWorkspace();
  const { id } = await params;
  redirectWithQuery(`/pos/day-end/z-reports/${id}`, await searchParams);
}
