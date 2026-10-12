import { getPosSaleTaxes } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// A finished sale's tax exactly as charged (the receipt, a reprint), with what returns have reversed since.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => ({ taxes: await getPosSaleTaxes(client, context, id) }), "pos.view");
}
