import { z } from "zod";

import { generatePosInvoice, getPosInvoiceForSale } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const generateSchema = z.object({
  notes: z.string().trim().max(2_000).optional().nullable(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.invoice.view" }, async ({ client, session }) => {
    const { id } = await context.params;
    const result = await getPosInvoiceForSale(client, posContext(session), id);
    return ok(result);
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.invoice.generate" }, async ({ client, session }) => {
    const { id } = await context.params;
    const input = generateSchema.parse(await readJson(request));
    const result = await generatePosInvoice(client, posContext(session), id, input);
    return ok(result, 201);
  });
}
