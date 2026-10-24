import { listCoupons, saveCoupon } from "@vercentlabs/api";

import { couponSchema } from "@/features/sales/settings/coupon-schema";
import { salesMutation, salesRead } from "@/features/sales/shared/route-helpers";

// Coupons (Sales report Phase 3); ?includeInactive=1 shows the switched-off ones too.
export async function GET(request: Request) {
  const includeInactive = new URL(request.url).searchParams.get("includeInactive") === "1";
  return salesRead(request, "sales.settings.manage", async (client, context) => listCoupons(client, context, { includeInactive }));
}

export async function POST(request: Request) {
  return salesMutation(request, "sales.settings.manage", couponSchema, async (client, context, input) => saveCoupon(client, context, input), 201);
}
