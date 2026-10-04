import { SalesQuotationFormScreen } from "@/features/sales/quotations/screens/SalesQuotationFormScreen";

export const metadata = { title: "New quotation" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{
    customer?: string;
    contact?: string;
  }>;
}) {
  const { customer, contact } =
    await searchParams;
  return (
    <SalesQuotationFormScreen
      initialPartyId={customer}
      initialContactId={contact}
    />
  );
}
