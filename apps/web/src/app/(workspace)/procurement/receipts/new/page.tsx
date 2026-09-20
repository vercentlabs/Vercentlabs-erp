import { FormPage } from "@/features/procurement/registry/registry";

export const metadata = { title: "New goods receipt" };

export default async function Page({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order } = await searchParams;
  return <FormPage name="receipts" sourceKind={order ? "order" : undefined} sourceId={order} />;
}
