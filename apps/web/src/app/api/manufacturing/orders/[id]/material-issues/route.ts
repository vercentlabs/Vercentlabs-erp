import { getMoMaterialIssueHistory, issueManufacturingMaterials } from "@vercentlabs/api";
import { z } from "zod";

import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// GET the order's material issue notes. POST the order's "Issue materials": an issue note created and posted at once — the same posting
// path as /api/manufacturing/material-issues/{id}/post, never a second one.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingRead(request, async (client, context) => ({ issues: await getMoMaterialIssueHistory(client, context, id) }));
}

const quantity = z.union([z.string(), z.number()]);
const schema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200).optional(), note: z.string().max(1000).optional(),
  lines: z.array(z.object({ materialId: z.string().uuid(), quantity, batchId: z.string().uuid().nullable().optional(), serialIds: z.array(z.string().uuid()).max(500).optional() })).max(200),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return manufacturingMutation(request, schema, async (client, context, input) => await issueManufacturingMaterials(client, context, id, input));
}
