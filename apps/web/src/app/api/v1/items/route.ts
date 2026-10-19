import { apiCreateItem, apiListItems } from "@vercentlabs/api";

import { apiList, apiCreate } from "@/core/api-records";

// GET /api/v1/items (scope items.read): ?limit= (up to 200), ?offset=, ?search= and the list's filters.
export async function GET(request: Request) {
  return apiList(request, "items.read", ({ client, principal }, query) => apiListItems(client, principal, query));
}

// POST /api/v1/items (scope items.write): the record as JSON, checked exactly as on screen.
export async function POST(request: Request) {
  return apiCreate(request, "items.write", ({ client, principal }, input) => apiCreateItem(client, principal, input));
}
