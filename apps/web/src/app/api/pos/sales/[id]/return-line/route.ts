import { findPosSaleLineByBarcode } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// ?barcode=&serial= — the line of this sale a returned product matches, with what is left to return. Finding it returns nothing and refunds
// nothing; the return itself goes through the return workflow and its approvals.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const search = new URL(request.url).searchParams;
  return posRead(request, async (client, context) => ({
    line: await findPosSaleLineByBarcode(client, context, id, { barcode: search.get("barcode") ?? "", serialNumber: search.get("serial") }),
  }), "pos.view");
}
