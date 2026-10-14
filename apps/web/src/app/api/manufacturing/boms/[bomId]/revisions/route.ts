import { z } from "zod";

import { createBomRevision, getManufacturingBom } from "@vercentlabs/api";

import { manufacturingMutation, manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// The revision history of a BOM (every revision and its effectivity windows).
export async function GET(request: Request, ctx: { params: Promise<{ bomId: string }> }) {
  const { bomId } = await ctx.params;
  return manufacturingRead(request, async (client, context) => {
    const bom = await getManufacturingBom(client, context, bomId);
    return { revisions: bom.revisions, effectivities: bom.effectivities, effectiveRevisionId: bom.effectiveRevisionId };
  });
}

// A new draft revision copied from an approved one; the same idempotency key returns the draft it created.
const schema = z.object({ basedOnRevisionId: z.string().uuid().optional(), fromRevisionId: z.string().uuid().optional(), changeReason: z.string().trim().min(1).max(500),
  idempotencyKey: z.string().trim().min(1).max(200).optional() });

export async function POST(request: Request, ctx: { params: Promise<{ bomId: string }> }) {
  const { bomId } = await ctx.params;
  return manufacturingMutation(request, schema, async (client, context, input) => ({ bom: await createBomRevision(client, context, bomId, input) }), 201);
}
