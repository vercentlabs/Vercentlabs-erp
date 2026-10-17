import { generateDueMaintenanceOccurrences } from "@vercentlabs/api";
import { z } from "zod";

import { assetsMutation } from "@/features/assets/shared/route-helpers";

// POST create the Work Orders of every service now due (each occurrence once, however often it is run).
export async function POST(request: Request) {
  return assetsMutation(request, z.record(z.string(), z.unknown()), (client, context) => generateDueMaintenanceOccurrences(client, context, {}));
}
