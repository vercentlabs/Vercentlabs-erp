import { redirect } from "next/navigation";

// Order Fulfillment is now Pending Orders › To dispatch (Sales audit: one place for "where is my order").
export default async function Page({ searchParams }: { searchParams: Promise<{ report?: string }> }) {
  const { report } = await searchParams;
  redirect(`/sales/pending-orders?report=${encodeURIComponent(report ?? "fulfillment")}`);
}
