import { TerminalDetailScreen } from "@/features/pos/terminals/screens/TerminalDetailScreen";

export const metadata = { title: "POS terminal" };

export default async function Page({ params, searchParams }: { params: Promise<{ terminalId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { terminalId } = await params;
  const { tab } = await searchParams;
  return <TerminalDetailScreen terminalId={terminalId} initialTab={tab ?? null} />;
}
