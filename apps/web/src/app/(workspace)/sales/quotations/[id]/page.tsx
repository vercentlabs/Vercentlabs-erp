import { SalesQuotationDetailScreen } from "@/features/sales/quotations/screens/SalesQuotationDetailScreen";

export const metadata = { title: "Quotation" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SalesQuotationDetailScreen quotationId={id} />;
}
