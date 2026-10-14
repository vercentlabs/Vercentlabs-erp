import { getManufacturingHome } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// The Manufacturing overview: orders by state, decisions waiting, late and short work.
export async function GET(request: Request) {
  return manufacturingRead(request, async (client, context) => ({ home: await getManufacturingHome(client, context) }));
}
