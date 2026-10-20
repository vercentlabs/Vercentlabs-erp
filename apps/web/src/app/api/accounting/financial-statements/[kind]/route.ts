import { getBalanceSheetStatement, getCashFlowStatement, getProfitAndLossStatement, getStatementPeriods, getTrialBalanceStatement } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { accountingRead } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ kind: string }> };

// The financial statements: trial-balance · profit-and-loss · balance-sheet · cash-flow, and the period choices (periods).
export async function GET(request: Request, { params }: Params) {
  const { kind } = await params;
  const search = new URL(request.url).searchParams;
  const filters: Record<string, string> = {};
  for (const key of ["from", "to", "asOf", "compare", "compareTo", "showZero"]) {
    const value = search.get(key);
    if (value) filters[key] = value;
  }
  return accountingRead(request, async (client, context) => {
    switch (kind) {
      case "trial-balance": return { statement: await getTrialBalanceStatement(client, context, filters) };
      case "profit-and-loss": return { statement: await getProfitAndLossStatement(client, context, filters) };
      case "balance-sheet": return { statement: await getBalanceSheetStatement(client, context, filters) };
      case "cash-flow": return { statement: await getCashFlowStatement(client, context, filters) };
      case "periods": return { periods: await getStatementPeriods(client, context) };
      default: throw new HttpError(404, "Unknown statement.");
    }
  });
}
