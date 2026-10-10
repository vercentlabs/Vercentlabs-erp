import { z } from "zod";

import { getScannerConfiguration, updateScannerConfiguration } from "@vercentlabs/api";

import { posMutation, posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ terminalId: string }> };

// How this terminal's keyboard-wedge scanner sends codes (prefix, suffix) and the feedback sounds. Changing it needs
// pos.terminals.configure_hardware and is recorded in the terminal's history.
export async function GET(request: Request, { params }: Params) {
  const { terminalId } = await params;
  return posRead(request, async (client, context) => ({ settings: await getScannerConfiguration(client, context, terminalId) }), "pos.view");
}

const schema = z.object({
  enabled: z.boolean().optional(),
  prefix: z.string().max(10).nullable().optional(),
  suffix: z.enum(["enter", "tab", "custom"]).optional(),
  suffixCustom: z.string().max(10).nullable().optional(),
  successSound: z.boolean().optional(),
  errorSound: z.boolean().optional(),
  expectedVersion: z.number().int().optional(),
});

export async function PATCH(request: Request, { params }: Params) {
  const { terminalId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ settings: await updateScannerConfiguration(client, context, terminalId, input) }), 200, "pos.view");
}
