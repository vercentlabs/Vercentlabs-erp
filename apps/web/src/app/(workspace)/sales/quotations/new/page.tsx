import { SalesQuotationFormScreen } from "@/features/sales/quotations/screens/SalesQuotationFormScreen";

export const metadata = { title: "New quotation" };

export default async function Page({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const { customer } = await searchParams;
  return <SalesQuotationFormScreen initialPartyId={customer} />;
}
