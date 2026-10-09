import { TransfersScreen } from "@/features/transfers/screens/TransfersScreen";

export const metadata = { title: "Transfers" };

export default async function Page({ searchParams }: { searchParams: Promise<{ itemId?: string }> }) {
  const { itemId } = await searchParams;
  return <TransfersScreen initialItemId={typeof itemId === "string" ? itemId : undefined} />;
}
