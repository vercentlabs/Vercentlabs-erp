import { z } from "zod";

import { approveExpense, cancelExpense, payExpense, rejectExpense, reverseExpense, submitExpense } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { accountingMutation } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ expenseId: string; action: string }> };
const schema = z.object({
  reason: z.string().trim().max(500).optional(), paidFromAccountId: z.string().uuid().optional(), date: z.string().date().optional(),
  paymentMethod: z.enum(["cash", "upi", "card", "bank_transfer", "cheque", "other"]).optional(),
});

// submit · approve (someone else; posts it) · reject (send back, with why) · cancel (with why) · pay (one still owed) · reverse (with why).
// Each step's rules — permission, who may approve, the evidence — are the domain's.
export async function POST(request: Request, { params }: Params) {
  const { expenseId, action } = await params;
  return accountingMutation(request, schema, async (client, context, input) => {
    switch (action) {
      case "submit": return { expense: await submitExpense(client, context, expenseId) };
      case "approve": return { expense: await approveExpense(client, context, expenseId) };
      case "reject": return { expense: await rejectExpense(client, context, expenseId, input) };
      case "cancel": return { expense: await cancelExpense(client, context, expenseId, input) };
      case "pay": return { expense: await payExpense(client, context, expenseId, input) };
      case "reverse": return { expense: await reverseExpense(client, context, expenseId, input) };
      default: throw new HttpError(404, "Unknown expense action.");
    }
  });
}
