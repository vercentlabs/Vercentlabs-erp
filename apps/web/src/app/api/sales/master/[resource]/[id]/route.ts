import { z } from "zod";

import { archiveBusinessDataRecord, updateBusinessDataRecord } from "@vercentlabs/api";

import { assertWritable, shapeCustomerInput } from "@/features/sales/master/server/master-resources";
import { emptySchema } from "@/features/sales/shared/schemas";
import { salesMutation } from "@/features/sales/shared/route-helpers";

export async function PATCH(request: Request, ctx: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await ctx.params;
  return salesMutation(request, "parties.manage", z.record(z.string(), z.unknown()), async (client, context, input) => {
    assertWritable(resource);
    return { record: await updateBusinessDataRecord(client, context, resource, id, shapeCustomerInput(resource, input, false)) };
  });
}

// "Delete" archives (sets the record inactive); history that references it stays intact.
export async function DELETE(request: Request, ctx: { params: Promise<{ resource: string; id: string }> }) {
  const { resource, id } = await ctx.params;
  return salesMutation(request, "parties.manage", emptySchema, async (client, context) => {
    assertWritable(resource);
    return { record: await archiveBusinessDataRecord(client, context, resource, id) };
  });
}
