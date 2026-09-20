import { FormPage } from "@/features/procurement/registry/registry";

export const metadata = { title: "New purchase order" };

export default async function Page({ searchParams }: { searchParams: Promise<{ requisition?: string; agreement?: string }> }) {
  const { requisition, agreement } = await searchParams;
  const sourceKind = requisition ? "requisition" : agreement ? "agreement" : undefined;
  return <FormPage name="orders" sourceKind={sourceKind} sourceId={requisition ?? agreement} />;
}
