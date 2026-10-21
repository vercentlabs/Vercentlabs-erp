import { TerminalFormScreen } from "@/features/pos/terminals/screens/TerminalFormScreen";

export const metadata = { title: "New POS terminal" };

export default async function Page({ searchParams }: { searchParams: Promise<{ outletId?: string }> }) {
  const { outletId } = await searchParams;
  return <TerminalFormScreen outletId={outletId ?? null} />;
}
