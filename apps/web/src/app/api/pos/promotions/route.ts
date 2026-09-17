import { z } from "zod";

import { assertSameOriginOrMobile, listPosPromotions, createPosPromotion } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { posContext, requirePosAccess } from "@/features/pos/shared/pos-context";

const createSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  storeId: z.string().uuid().optional().nullable(),
  effectiveFrom: z.string().optional().nullable(),
  effectiveTo: z.string().optional().nullable(),
  discountType: z.enum(["percent", "amount"]),
  discountValue: z.number().positive(),
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

export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session);
      return listPosPromotions(client, posContext(session), { status: url.searchParams.get("status") || undefined });
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = createSchema.parse(await readJson(request));
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requirePosAccess(client, session, "pos.settings.manage");
      return createPosPromotion(client, posContext(session), input);
    });
    return ok({ record: result }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
