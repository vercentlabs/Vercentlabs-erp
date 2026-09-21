import { notFound } from "next/navigation";

import { SUPPORT_PAGES } from "@/features/support/pages";
import { SupportPage } from "@/features/support/SupportPage";

export async function generateMetadata({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  return { title: SUPPORT_PAGES[page]?.title ?? "Support" };
}

export default async function Page({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!(page in SUPPORT_PAGES)) notFound();
  return <SupportPage name={page} />;
}
