import {
  approveProjectExpense, recordExpenseReimbursement, rejectProjectExpense, requestExpenseChanges, requestExpenseCorrection, reviewExpenseForFinance, setExpenseBilling, submitProjectExpense,
  withdrawProjectExpense,
} from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { projectsMutation } from "@/features/projects/shared/route-helpers";

// The claim's commands; each checks who may act (the claimant, the project's manager, Finance) and the claim's state.
type Params = { params: Promise<{ expenseId: string; action: string }> };
type Input = Record<string, unknown>;
type Command = (client: Parameters<typeof submitProjectExpense>[0], context: Parameters<typeof submitProjectExpense>[1], id: string, input: Input) => Promise<unknown>;
const COMMANDS: Record<string, Command> = {
  submit: submitProjectExpense, withdraw: withdrawProjectExpense, approve: approveProjectExpense, "request-changes": requestExpenseChanges, reject: rejectProjectExpense,
  "finance-review": reviewExpenseForFinance, reimburse: recordExpenseReimbursement, billing: setExpenseBilling, correction: requestExpenseCorrection,
};
export async function POST(request: Request, ctx: Params) {
  const { expenseId, action } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    const command = COMMANDS[action];
    if (!command) throw new HttpError(404, "Unknown expense action.", "NOT_FOUND");
    return command(client, context, expenseId, input);
  });
}
