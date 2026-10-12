import { z } from "zod";

import { approveExpense, cancelExpense, payExpense, rejectExpense, reverseExpense, submitExpense } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { accountingMutation } from "@/features/accounting/shared/route-helpers";

// submit · approve (a second person; posts it) · reject · cancel · pay (an expense recorded as payable) · reverse.
const schema = z.object({ reason: z.string().max(500).optional(), paidFromAccountId: z.string().uuid().optional(), date: z.string().date().optional() });
const PERMISSION: Record<string, string> = { submit: "accounting.payables.manage", approve: "accounting.payables.approve", reject: "accounting.payables.approve",
  cancel: "accounting.payables.manage", pay: "accounting.payments.manage", reverse: "accounting.payables.approve" };

export async function POST(request: Request, ctx: { params: Promise<{ expenseId: string; action: string }> }) {
  const { expenseId, action } = await ctx.params;
  return accountingMutation(request, schema, async (client, context, input) => {
    switch (action) {
      case "submit": return { expense: await submitExpense(client, context, expenseId) };
      case "approve": return { expense: await approveExpense(client, context, expenseId) };
      case "reject": return { expense: await rejectExpense(client, context, expenseId, input) };
      case "cancel": return { expense: await cancelExpense(client, context, expenseId) };
      case "pay": return { expense: await payExpense(client, context, expenseId, input) };
      case "reverse": return { expense: await reverseExpense(client, context, expenseId, input) };
      default: throw new HttpError(404, "Unknown expense action.", "NOT_FOUND");
    }
  }, 200, PERMISSION[action] ?? "accounting.view");
}
