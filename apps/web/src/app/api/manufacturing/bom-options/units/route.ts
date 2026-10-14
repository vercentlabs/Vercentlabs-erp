import { getBomItemUnits } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// One item's units (?itemId=) and its approved recipes.
export async function GET(request: Request) {
  const itemId = new URL(request.url).searchParams.get("itemId") ?? "";
  return manufacturingRead(request, async (client, context) => {
    if (!itemId) throw new HttpError(400, "Choose an item.", "VALIDATION_FAILED");
    return { units: await getBomItemUnits(client, context, itemId) };
  });
}
