import { OutletDetailScreen } from "@/features/pos/outlets/screens/OutletDetailScreen";

export const metadata = { title: "Store / outlet" };

export default async function Page({ params, searchParams }: { params: Promise<{ outletId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { outletId } = await params;
  const { tab } = await searchParams;
  return <OutletDetailScreen outletId={outletId} initialTab={tab ?? null} />;
}
