import { Suspense } from "react";

import { InvoiceSourceScreen } from "@/features/assets/invoices/InvoiceScreens";

export const metadata = { title: "Create assets from invoice" };
export default async function Page({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  return <Suspense><InvoiceSourceScreen invoiceId={invoiceId} /></Suspense>;
}
