import { notFound } from "next/navigation";

import { QUALITY_PAGES } from "@/features/quality/pages";
import { QualityPage } from "@/features/quality/QualityPage";

export async function generateMetadata({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  return { title: QUALITY_PAGES[page]?.title ?? "Quality" };
}

export default async function Page({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!(page in QUALITY_PAGES)) notFound();
  return <QualityPage name={page} />;
}
