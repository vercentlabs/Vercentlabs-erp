import { confirmBatchSetup } from "@vercentlabs/api";
import { z } from "zod";

import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// Confirm a batch's setup: from now on it earns its fixed batch overhead (once), even before output is reported.
export async function POST(request: Request, ctx: { params: Promise<{ id: string; batchId: string }> }) {
  const { batchId } = await ctx.params;
  return manufacturingMutation(request, z.record(z.string(), z.unknown()), async (client, context) => confirmBatchSetup(client, context, batchId));
}
