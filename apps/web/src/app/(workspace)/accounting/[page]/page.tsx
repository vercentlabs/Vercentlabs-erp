import { notFound } from "next/navigation";

import { ACCOUNTING_PAGES } from "@/features/accounting/pages";
import { AccountingPage } from "@/features/accounting/AccountingPage";

export async function generateMetadata({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  return { title: ACCOUNTING_PAGES[page]?.title ?? "Accounting" };
}

export default async function Page({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!(page in ACCOUNTING_PAGES)) notFound();
  return <AccountingPage name={page} />;
}
