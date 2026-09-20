import { notFound } from "next/navigation";

import { INVENTORY_PAGES } from "@/features/inventory/pages";
import { InventoryPage } from "@/features/inventory/InventoryPage";

export async function generateMetadata({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  return { title: INVENTORY_PAGES[page]?.title ?? "Inventory" };
}

export default async function Page({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!(page in INVENTORY_PAGES)) notFound();
  return <InventoryPage name={page} />;
}
