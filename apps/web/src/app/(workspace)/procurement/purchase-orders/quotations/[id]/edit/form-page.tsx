import { SupplierQuotationFormScreen } from "@/features/procurement/purchase-orders/screens/QuotationScreens";

export const metadata = { title: "Edit supplier quotation" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SupplierQuotationFormScreen quotationId={id} />;
}
