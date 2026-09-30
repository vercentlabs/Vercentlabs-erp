import { redirect } from "next/navigation";

import { requireWorkspace } from "@/core/session";

// The dashboard is CRM Home (/crm). This address keeps working — with its
// scope/period/filter query intact, so shared and bookmarked views still
// open the same figures.
export default async function CrmDashboardPage({
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
  redirect(query.size ? `/crm?${query.toString()}` : "/crm");
}
