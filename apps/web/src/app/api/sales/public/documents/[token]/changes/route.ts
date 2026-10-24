import { requestQuotationChanges } from "@vercentlabs/api";

import { sharedAnswer } from "../../../shared-answer";

// The customer asks for changes to a shared quotation: { name, note }.
export async function POST(request: Request, route: { params: Promise<{ token: string }> }) {
  const { token } = await route.params;
  return sharedAnswer(request, token, "Your request could not be sent. Try again.", (client, body) =>
    requestQuotationChanges(client, token, { name: String(body.name ?? ""), note: String(body.note ?? "") }));
}
