import { notFound } from "next/navigation";

import { HR_PAGES } from "@/features/hr/pages";
import { HrPage } from "@/features/hr/HrPage";

export async function generateMetadata({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  return { title: HR_PAGES[page]?.title ?? "HR & Payroll" };
}

export default async function Page({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!(page in HR_PAGES)) notFound();
  return <HrPage name={page} />;
}
