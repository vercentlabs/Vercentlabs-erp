import { Suspense } from "react";

import { ScrapPrintScreen } from "@/features/manufacturing/scrap/screens/ScrapPrintScreen";

export const metadata = { title: "Manufacturing Scrap Note" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><ScrapPrintScreen scrapId={id} /></Suspense>;
}
