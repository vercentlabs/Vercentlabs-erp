import { z } from "zod";

import { holdPosCart } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

// A short note for whoever resumes the bill ("gone to fetch wallet").
const holdSchema = z.object({ expectedVersion: z.number().int().optional(), note: z.string().trim().max(200).optional().nullable(), idempotencyKey: z.string().min(8).max(100).optional() });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return workspaceRoute(
    request,
    {
      module: "point-of-sale",
      permission: "pos.sale.create",
      billingWrite: true,
    },
    async ({ client, session }) => {
      const { id } = await context.params;
      const input = holdSchema.parse(await readJson(request).catch(() => ({})));
      const result = await holdPosCart(client, posContext(session), id, input);
      return ok({ cart: result });
    },
  );
}
