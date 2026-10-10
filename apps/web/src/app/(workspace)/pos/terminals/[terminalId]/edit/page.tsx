import { TerminalFormScreen } from "@/features/pos/terminals/screens/TerminalFormScreen";

export const metadata = { title: "Set up POS terminal" };

export default async function Page({ params }: { params: Promise<{ terminalId: string }> }) {
  const { terminalId } = await params;
  return <TerminalFormScreen terminalId={terminalId} />;
}
