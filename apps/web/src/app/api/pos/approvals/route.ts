import { z } from "zod";

import { listPosApprovals, requestSupervisorApproval } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

// ?status=pending|approved|rejected|consumed|expired, ?mine=true (the caller's own requests)
export async function GET(request: Request) {
  const url = new URL(request.url);
  return posRead(request, async (client, context) => ({
    approvals: await listPosApprovals(client, context, { status: url.searchParams.get("status") ?? "pending", mine: url.searchParams.get("mine") === "true" }),
  }), "pos.view");
}

// A cashier asks for an exception: body { permission, resource: { type, id }, amount?, percentage?, action?, reason, idempotencyKey? }.
export async function POST(request: Request) {
  const schema = z.object({
    permission: z.string(), resource: z.object({ type: z.string(), id: z.string().uuid() }), amount: z.union([z.string(), z.number()]).nullable().optional(),
    percentage: z.union([z.string(), z.number()]).nullable().optional(), action: z.record(z.string(), z.unknown()).optional(), reason: z.string().trim().min(1).max(500),
    idempotencyKey: z.string().max(120).optional(),
  });
  return posMutation(request, schema, async (client, context, input) => ({ approval: await requestSupervisorApproval(client, context, input) }), 201, "pos.view");
}
