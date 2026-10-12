import { TerminalsScreen } from "@/features/pos/terminals/screens/TerminalsScreen";

export const metadata = { title: "POS Terminals" };

export default async function Page({ searchParams }: { searchParams: Promise<{ outletId?: string }> }) {
  const { outletId } = await searchParams;
  return <TerminalsScreen initialOutletId={outletId ?? null} />;
}
