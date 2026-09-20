import { SalesQuotationFormScreen } from "@/features/sales/quotations/screens/SalesQuotationFormScreen";

export const metadata = { title: "Revise quotation" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SalesQuotationFormScreen quotationId={id} />;
}
