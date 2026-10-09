import { z } from "zod";

import { validateOpeningStock } from "@vercentlabs/api";
import { OPENING_STOCK_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// The validation preview: errors, warnings and the totals posting would bring in.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context) => ({ validation: await validateOpeningStock(client, context, id) }), 200, OPENING_STOCK_PERMISSIONS.view);
}
