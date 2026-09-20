import { SettlementDetailScreen } from "@/features/hr/screens/CloseScreens";

export const metadata = { title: "Final settlement" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SettlementDetailScreen id={id} />;
}
