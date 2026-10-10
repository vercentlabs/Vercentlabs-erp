import "server-only";

import { enforceRateLimit } from "@vercentlabs/api";

import { withIngressClient } from "@/core/db";
import { posRead } from "@/features/pos/shared/route-helpers";

// Product Search reads (POS access, pos.view): who is selling where comes from the person's session or cart on the server; the screen only
// says which cart (or, for a supervisor looking up an outlet, which outlet). Typed search is rate-limited per person, generously, so normal
// typing and scanning never notice; barcode lookups have their own, larger allowance.
export type Locator = { cartId?: string; outletId?: string };

export function locatorOf(request: Request): Locator {
  const params = new URL(request.url).searchParams;
  const uuid = (value: string | null) => (value && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined);
  return { cartId: uuid(params.get("cartId")), outletId: uuid(params.get("outletId")) };
}

export function productRead<T>(request: Request, run: Parameters<typeof posRead<T>>[1], limit?: { bucket: "search" | "barcode" }) {
  return posRead<T>(request, async (client, context) => {
    if (limit) {
      const [maximum, key] = limit.bucket === "search" ? [300, `pos-search:${context.userId}`] : [1200, `pos-barcode:${context.userId}`];
      await withIngressClient((ingress) => enforceRateLimit(ingress, key, maximum, 60));
    }
    return run(client, context);
  }, "pos.view");
}
