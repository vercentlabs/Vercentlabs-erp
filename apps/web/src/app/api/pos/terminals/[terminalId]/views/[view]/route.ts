import { getEffectiveTerminalConfiguration, getTerminalHistory, getTerminalSessions, getTerminalTransactions } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ terminalId: string; view: string }> };

// The terminal's tabs: sessions, transactions (?kind=sales|returns|voided), history, and its effective configuration.
export async function GET(request: Request, { params }: Params) {
  const { terminalId, view } = await params;
  const filters = Object.fromEntries(new URL(request.url).searchParams.entries());
  return posRead(request, async (client, context) => {
    switch (view) {
      case "sessions": return { rows: await getTerminalSessions(client, context, terminalId) };
      case "transactions": return { rows: await getTerminalTransactions(client, context, terminalId, filters) };
      case "history": return { rows: await getTerminalHistory(client, context, terminalId) };
      case "effective": return { configuration: await getEffectiveTerminalConfiguration(client, context, terminalId) };
      default: throw new HttpError(404, "Unknown terminal view.");
    }
  }, "pos.terminals.view");
}
