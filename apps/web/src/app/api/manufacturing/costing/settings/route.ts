import { setCostingSettings } from "@vercentlabs/api";
import { z } from "zod";

import { manufacturingMutation } from "@/features/manufacturing/shared/route-helpers";

// Turn labor and overhead application on or off (an enabled component needs its rate before an order is released).
export async function PUT(request: Request) {
  return manufacturingMutation(request, z.object({ laborEnabled: z.boolean().optional(), overheadEnabled: z.boolean().optional() }),
    async (client, context, input) => setCostingSettings(client, context, input));
}
