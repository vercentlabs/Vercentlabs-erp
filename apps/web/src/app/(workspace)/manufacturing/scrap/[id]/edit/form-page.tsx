import { Suspense } from "react";

import { ScrapFormScreen } from "@/features/manufacturing/scrap/screens/ScrapFormScreen";

export const metadata = { title: "Edit scrap note" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><ScrapFormScreen scrapId={id} /></Suspense>;
}
