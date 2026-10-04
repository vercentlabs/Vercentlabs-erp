import { redirect } from "next/navigation";

import { requireWorkspace } from "@/core/session";

// Pipeline is a view of the Opportunities workspace. This address keeps
// working (bookmarks, mobile web links) and opens the board layout.
export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireWorkspace();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : [value])
      if (item !== undefined) query.append(key, item);
  }
  query.delete("view");
  query.set("layout", "board");
  redirect(`/crm/opportunities?${query.toString()}`);
}
