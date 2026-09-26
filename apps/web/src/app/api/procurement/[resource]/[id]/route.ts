import { z } from "zod";

import { getProcurementRecord, updateProcurementRecord } from "@vercentlabs/api";

import { procurementMutation, procurementRead } from "@/features/procurement/shared/route-helpers";

export async function GET(request: Request, ctx: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await ctx.params;
  return procurementRead(request, async (client, context) => ({ record: await getProcurementRecord(client, context, resource, id) }));
}

// Editing is limited by the domain to draft/rejected documents and requires the
// expectedVersion the caller loaded (optimistic concurrency).
export async function PATCH(request: Request, ctx: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await ctx.params;
  return procurementMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ record: await updateProcurementRecord(client, context, resource, id, input) }));
}
