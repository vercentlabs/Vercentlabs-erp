import { Suspense } from "react";

import { CategoryDetailScreen } from "@/features/assets/categories/CategoryScreens";

export const metadata = { title: "Asset category" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><CategoryDetailScreen categoryId={id} /></Suspense>;
}
