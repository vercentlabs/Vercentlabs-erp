import { z } from "zod";

import { cancelTdsDeposit, form26QData, listTdsDeposits, listTdsToDeposit, recordTdsDeposit } from "@vercentlabs/api";

import { accountingMutation, accountingRead } from "@/features/accounting/shared/route-helpers";

// Supplier TDS: ?view=to-deposit (&period) what waits to be deposited; ?view=deposits (&fy) the challans; ?view=26q &fy &quarter the
// quarter's return data. POST { action: deposit, ... } records a challan; { action: cancel, challanId, reason } cancels one.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const view = q.get("view") ?? "to-deposit";
  return accountingRead(request, async (client, context) => {
    if (view === "deposits") return listTdsDeposits(client, context, { fy: q.get("fy") ?? undefined });
    if (view === "26q") return form26QData(client, context, { fy: q.get("fy") ?? "", quarter: q.get("quarter") ?? "" });
    return listTdsToDeposit(client, context, { period: q.get("period") ?? undefined });
  });
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("deposit"), taxLedgerIds: z.array(z.string().uuid()).min(1).max(2000), depositDate: z.string(), bsrCode: z.string(), challanSerial: z.string(),
    interest: z.string().optional(), fee: z.string().optional(), extraAccountId: z.string().uuid().optional(), bankAccountId: z.string().uuid().optional(), notes: z.string().max(500).optional() }),
  z.object({ action: z.literal("cancel"), challanId: z.string().uuid(), reason: z.string().max(500) }),
]);

export async function POST(request: Request) {
  return accountingMutation(request, schema, async (client, context, input) => ({
    result: input.action === "cancel" ? await cancelTdsDeposit(client, context, input.challanId, { reason: input.reason }) : await recordTdsDeposit(client, context, input),
  }), 200, "accounting.tax.manage");
}
