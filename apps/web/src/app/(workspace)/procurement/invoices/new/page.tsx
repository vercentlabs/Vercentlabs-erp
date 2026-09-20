import { InvoiceFormPage } from "@/features/procurement/registry/registry";

export const metadata = { title: "Record supplier invoice" };

export default async function Page({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order } = await searchParams;
  return <InvoiceFormPage orderId={order} />;
}
