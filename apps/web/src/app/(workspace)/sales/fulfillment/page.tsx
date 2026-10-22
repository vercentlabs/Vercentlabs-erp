import { redirect } from "next/navigation";

// Order Fulfillment is now Reports › Orders › To dispatch (Sales plan: one Reports page).
export default async function Page({ searchParams }: { searchParams: Promise<{ report?: string }> }) {
  const { report } = await searchParams;
  redirect(`/sales/reports?tab=orders&report=${encodeURIComponent(report ?? "fulfillment")}`);
}
