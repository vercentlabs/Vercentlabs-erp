import { redirect } from "next/navigation";

// Pending Orders is now Reports › Orders (Sales plan: one Reports page); its old links keep working.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = new URLSearchParams(Object.entries(await searchParams).filter(([, value]) => value) as Array<[string, string]>);
  params.set("tab", "orders");
  redirect(`/sales/reports?${params}`);
}
