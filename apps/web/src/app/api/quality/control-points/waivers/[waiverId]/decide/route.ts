import { decideQualityWaiver } from "@vercentlabs/api";
import { z } from "zod";

import { qualityMutation } from "@/features/quality/shared/route-helpers";

// Approve or reject a waiver request (body.decision APPROVE | REJECT, body.note); the requester cannot decide their own.
export async function POST(request: Request, ctx: { params: Promise<{ waiverId: string }> }) {
  const { waiverId } = await ctx.params;
  return qualityMutation(request, z.record(z.string(), z.unknown()), (client, context, input) => decideQualityWaiver(client, context, waiverId, input));
}
