import { cashReturnRoute } from "@/features/pos/shared/cash-return-route";

type Params = { params: Promise<{ checkoutId: string }> };

// Hand back cash taken for a bill that will not be finalised (a completed sale is never cancelled here; use a return).
export async function POST(request: Request, { params }: Params) {
  return cashReturnRoute(request, (await params).checkoutId);
}
