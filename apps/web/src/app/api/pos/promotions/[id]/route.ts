import { z } from "zod";

import { assertSameOriginOrMobile, updatePosPromotion } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  effectiveFrom: z.string().optional().nullable(),
  effectiveTo: z.string().optional().nullable(),
  discountValue: z.number().positive().optional(),
  maxDiscountAmount: z.number().positive().optional().nullable(),
  minQuantity: z.number().positive().optional().nullable(),
  minBasketAmount: z.number().min(0).optional().nullable(),
  eligibleItemIds: z.array(z.string().uuid()).optional(),
  eligibleItemGroupIds: z.array(z.string().uuid()).optional(),
  eligibleCustomerIds: z.array(z.string().uuid()).optional(),
  priority: z.number().int().optional(),
  stackable: z.boolean().optional(),
  exclusive: z.boolean().optional(),
  usageLimitTotal: z.number().int().positive().optional().nullable(),
  usageLimitPerCustomer: z.number().int().positive().optional().nullable(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { id } = await context.params;
    const input = updateSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.settings.manage");
      return updatePosPromotion(client, posContext(session), id, input);
    });
    return ok({ record: result });
  } catch (error) {
    return errorResponse(error);
  }
}
