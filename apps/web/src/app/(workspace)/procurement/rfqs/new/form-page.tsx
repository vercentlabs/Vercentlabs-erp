import { RfqFormScreen } from "@/features/procurement/rfqs/RfqScreens";

export const metadata = { title: "New RFQ" };

// ?indentLineIds= approved indent lines to ask prices for (from an indent).
export default async function Page({ searchParams }: { searchParams: Promise<{ indentLineIds?: string }> }) {
  const { indentLineIds } = await searchParams;
  return <RfqFormScreen indentLineIds={indentLineIds ? indentLineIds.split(",").filter(Boolean) : undefined} />;
}
