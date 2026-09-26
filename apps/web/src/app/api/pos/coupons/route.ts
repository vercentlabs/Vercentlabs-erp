import { z } from "zod";

import { listPosCoupons, createPosCoupon } from "@vercentlabs/api";

import { ok, readJson } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

const createSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().max(200).optional(),
  storeId: z.string().uuid().optional().nullable(),
  effectiveFrom: z.string().optional().nullable(),
  effectiveTo: z.string().optional().nullable(),
  discountType: z.enum(["percent", "amount"]),
  discountValue: z.number().positive(),
  maxDiscountAmount: z.number().positive().optional().nullable(),
  minBasketAmount: z.number().min(0).optional().nullable(),
  eligibleItemIds: z.array(z.string().uuid()).optional(),
  eligibleCustomerIds: z.array(z.string().uuid()).optional(),
  usageLimitTotal: z.number().int().positive().optional().nullable(),
  usageLimitPerCustomer: z.number().int().positive().optional().nullable(),
  usageLimitPerStore: z.number().int().positive().optional().nullable(),
});

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const rows = await listPosCoupons(client, posContext(session), { status: url.searchParams.get("status") || undefined });
    return ok({ rows });
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.settings.manage", billingWrite: true }, async ({ client, session }) => {
    const input = createSchema.parse(await readJson(request));
    const result = await createPosCoupon(client, posContext(session), input);
    return ok({ record: result }, 201);
  });
}
