import { z } from "zod";

import { testPosReceiptPrinter } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ printerId: string }> };

// POST: a printer test page — clearly NOT A TAX INVOICE, never a sale or a document number.
export async function POST(request: Request, { params }: Params) {
  const { printerId } = await params;
  return posMutation(request, z.object({}).passthrough(), async (client, context) => testPosReceiptPrinter(client, context, printerId), 200, "pos.settings.manage");
}
