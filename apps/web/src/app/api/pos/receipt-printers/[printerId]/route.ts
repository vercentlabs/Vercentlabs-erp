import { z } from "zod";

import { savePosReceiptPrinter } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ printerId: string }> };

// PUT: change a printer (administrators only), checked against the version you loaded.
const schema = z.object({
  name: z.string().trim().min(1).max(80),
  connectionMode: z.enum(["browser", "print_agent", "network_bridge"]).optional(),
  profile: z.enum(["thermal_generic", "escpos", "a4_document"]).optional(),
  paperWidthMm: z.union([z.literal(58), z.literal(80), z.literal(210)]).optional(),
  isDefault: z.boolean().optional(),
  autoPrint: z.boolean().optional(),
  copies: z.number().int().min(1).max(3).optional(),
  merchantCopy: z.boolean().optional(),
  cutPaper: z.boolean().optional(),
  encoding: z.enum(["utf-8", "cp437", "cp858"]).optional(),
  bridgeDeviceReference: z.string().trim().max(80).nullish(),
  enabled: z.boolean().optional(),
  expectedVersion: z.number().int().optional(),
});

export async function PUT(request: Request, { params }: Params) {
  const { printerId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ printer: await savePosReceiptPrinter(client, context, { ...input, id: printerId }) }), 200, "pos.settings.manage");
}
