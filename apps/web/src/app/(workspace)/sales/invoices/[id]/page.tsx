import { InvoiceDetailScreen } from "@/features/sales/invoices/screens/InvoiceDetailScreen";

export const metadata = { title: "Invoice" };

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <InvoiceDetailScreen invoiceId={id} />;
}
