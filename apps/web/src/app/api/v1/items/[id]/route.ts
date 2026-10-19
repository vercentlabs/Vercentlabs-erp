import { apiGetItem } from "@vercentlabs/api";

import { apiOne } from "@/core/api-records";

// GET /api/v1/items/{id} (scope items.read).
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiOne(request, "items.read", context.params, ({ client, principal }, id) => apiGetItem(client, principal, id));
}
