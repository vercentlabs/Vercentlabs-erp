import { Suspense } from "react";

import { ScrapDetailScreen } from "@/features/manufacturing/scrap/screens/ScrapDetailScreen";

export const metadata = { title: "Scrap note" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><ScrapDetailScreen scrapId={id} /></Suspense>;
}
