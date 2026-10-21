import { OutletFormScreen } from "@/features/pos/outlets/screens/OutletFormScreen";

export const metadata = { title: "Edit store / outlet" };

export default async function Page({ params }: { params: Promise<{ outletId: string }> }) {
  const { outletId } = await params;
  return <OutletFormScreen outletId={outletId} />;
}
