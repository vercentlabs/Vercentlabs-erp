import { Suspense } from "react";

import { MoDetailScreen } from "@/features/manufacturing/orders/screens/MoDetailScreen";

export const metadata = { title: "Manufacturing order" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Suspense><MoDetailScreen orderId={id} /></Suspense>;
}
