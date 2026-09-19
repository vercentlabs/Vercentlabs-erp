import { z } from "zod";

import { assertSameOriginOrMobile, setPosCartCustomer } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const customerSchema = z.object({
  customerId: z.string().uuid().nullable(),
  expectedVersion: z.number().int().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = customerSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.sale.create", { mutation: true });
      return setPosCartCustomer(client, posContext(session), id, input);
    });
    return ok({ cart: result });
  } catch (error) {
    return errorResponse(error);
  }
}
