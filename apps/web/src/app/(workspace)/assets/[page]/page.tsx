import { notFound } from "next/navigation";

import { ASSETS_PAGES } from "@/features/assets/pages";
import { AssetsPage } from "@/features/assets/AssetsPage";

export async function generateMetadata({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  return { title: ASSETS_PAGES[page]?.title ?? "Assets" };
}

export default async function Page({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!(page in ASSETS_PAGES)) notFound();
  return <AssetsPage name={page} />;
}
