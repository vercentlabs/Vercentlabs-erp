import { z } from "zod";

import { assertSameOriginOrMobile, updatePosCoupon } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const updateSchema = z.object({
  name: z.string().trim().max(200).optional().nullable(),
  effectiveFrom: z.string().optional().nullable(),
  effectiveTo: z.string().optional().nullable(),
  discountValue: z.number().positive().optional(),
  maxDiscountAmount: z.number().positive().optional().nullable(),
  minBasketAmount: z.number().min(0).optional().nullable(),
  eligibleItemIds: z.array(z.string().uuid()).optional(),
  eligibleCustomerIds: z.array(z.string().uuid()).optional(),
  usageLimitTotal: z.number().int().positive().optional().nullable(),
  usageLimitPerCustomer: z.number().int().positive().optional().nullable(),
  usageLimitPerStore: z.number().int().positive().optional().nullable(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = updateSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.settings.manage", { mutation: true });
      return updatePosCoupon(client, posContext(session), id, input);
    });
    return ok({ record: result });
  } catch (error) {
    return errorResponse(error);
  }
}
