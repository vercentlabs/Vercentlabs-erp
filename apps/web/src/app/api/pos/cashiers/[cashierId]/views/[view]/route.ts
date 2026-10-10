import { getCashierHistory, getCashierSessions, getCashierTransactions } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ cashierId: string; view: string }> };

// The cashier's tabs: sessions, transactions (?kind=sales|returns) and history.
export async function GET(request: Request, { params }: Params) {
  const { cashierId, view } = await params;
  const filters = Object.fromEntries(new URL(request.url).searchParams.entries());
  return posRead(request, async (client, context) => {
    switch (view) {
      case "sessions": return { rows: await getCashierSessions(client, context, cashierId) };
      case "transactions": return { rows: await getCashierTransactions(client, context, cashierId, filters) };
      case "history": return { rows: await getCashierHistory(client, context, cashierId) };
      default: throw new HttpError(404, "Unknown cashier view.");
    }
  }, "pos.cashiers.view");
}
