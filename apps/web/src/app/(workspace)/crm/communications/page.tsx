import { redirect } from "next/navigation";

import { requireWorkspace } from "@/core/session";

// A view of the My Work workspace (/crm/work?view=inbox). This address keeps
// working — bookmarks, detail-page back links and dashboard drill-downs such
// as ?due=overdue — and opens that view with its query intact.
export default async function CommunicationsPage({
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
  query.set("view", "inbox");
  redirect(`/crm/work?${query.toString()}`);
}
