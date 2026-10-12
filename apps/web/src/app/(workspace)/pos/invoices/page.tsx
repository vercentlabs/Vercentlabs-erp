import { requireWorkspace } from "@/core/session";
import { redirectWithQuery } from "@/shared/routing/redirect-with-query";

// GST invoices are Transactions › Documents now. This address keeps working for bookmarks and links.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireWorkspace();
  redirectWithQuery("/pos/transactions", await searchParams, {"tab":"documents"});
}
