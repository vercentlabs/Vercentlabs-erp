import { requireWorkspace } from "@/core/session";
import { redirectWithQuery } from "@/shared/routing/redirect-with-query";

// BOM versions are the revisions of each Bill of Materials now. This address keeps working for bookmarks and links.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireWorkspace();
  redirectWithQuery("/manufacturing/boms", await searchParams);
}
