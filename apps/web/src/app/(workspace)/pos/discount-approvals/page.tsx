import { requireWorkspace } from "@/core/session";
import { redirectWithQuery } from "@/shared/routing/redirect-with-query";

// Discount approvals are Supervisor Approvals now (every kind of cashier exception): this address keeps working for bookmarks and links.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireWorkspace();
  redirectWithQuery("/pos/approvals", await searchParams);
}
