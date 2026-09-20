import { FormPage } from "@/features/procurement/registry/registry";

export const metadata = { title: "New RFQ" };

export default async function Page({ searchParams }: { searchParams: Promise<{ requisition?: string }> }) {
  const { requisition } = await searchParams;
  return <FormPage name="rfqs" sourceKind={requisition ? "requisition" : undefined} sourceId={requisition} />;
}
