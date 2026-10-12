import { cashReturnRoute } from "@/features/pos/shared/cash-return-route";

type Params = { params: Promise<{ checkoutId: string }> };

// Cancel a pending cash payment: once cash was received, cancelling means handing it back.
export async function POST(request: Request, { params }: Params) {
  return cashReturnRoute(request, (await params).checkoutId);
}
