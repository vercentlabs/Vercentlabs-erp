import { notFound } from "next/navigation";

import { MANUFACTURING_PAGES } from "@/features/manufacturing/pages";
import { ManufacturingPage } from "@/features/manufacturing/ManufacturingPage";

export async function generateMetadata({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  return { title: MANUFACTURING_PAGES[page]?.title ?? "Manufacturing" };
}

export default async function Page({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!(page in MANUFACTURING_PAGES)) notFound();
  return <ManufacturingPage name={page} />;
}
