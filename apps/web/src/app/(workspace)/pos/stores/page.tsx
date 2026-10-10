import { requireWorkspace } from "@/core/session";
import { redirectWithQuery } from "@/shared/routing/redirect-with-query";

// Stores are Stores & Outlets now: this address keeps working for bookmarks and links.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireWorkspace();
  redirectWithQuery("/pos/outlets", await searchParams);
}
