import { redirect } from "next/navigation";

// CRM Home (/crm) is the one CRM overview. This old address stays only so
// bookmarks keep working: it forwards the scope and period it understood.
const FORWARDED = ["scope", "period", "from", "to"] as const;

export default async function CrmDashboardRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const incoming = await searchParams;
  const params = new URLSearchParams();
  for (const key of FORWARDED) {
    const value = incoming[key];
    if (typeof value === "string" && value) params.set(key, value);
  }
  const query = params.toString();
  redirect(query ? `/crm?${query}` : "/crm");
}
