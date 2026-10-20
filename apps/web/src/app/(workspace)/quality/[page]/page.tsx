import { notFound, redirect } from "next/navigation";

import { QUALITY_PAGES } from "@/features/quality/pages";
import { QualityPage } from "@/features/quality/QualityPage";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ page: string }>;
}) {
  const { page } = await params;
  return { title: QUALITY_PAGES[page]?.title ?? "Quality" };
}

export default async function Page({
  params,
}: {
  params: Promise<{ page: string }>;
}) {
  const { page } = await params;
  // Quality plans became Inspection Specifications (each published version is mirrored as the plan an inspection uses).
  if (page === "plans" || page === "plan-builder") redirect("/quality/specifications");
  // The generic inspection list became Incoming Inspections (MVP 31).
  if (page === "inspections" || page === "inspection-new") redirect("/quality/incoming");
  if (page === "open-inspections") redirect("/quality/incoming?view=in_progress");
  if (!(page in QUALITY_PAGES)) notFound();
  return <QualityPage name={page} />;
}
