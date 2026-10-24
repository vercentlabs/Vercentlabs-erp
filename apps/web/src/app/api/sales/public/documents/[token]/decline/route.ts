import { declineSharedQuotation } from "@vercentlabs/api";

import { sharedAnswer } from "../../../shared-answer";

// The customer declines a shared quotation: { name, reason }.
export async function POST(request: Request, route: { params: Promise<{ token: string }> }) {
  const { token } = await route.params;
  return sharedAnswer(request, token, "Your answer could not be recorded. Try again.", (client, body) =>
    declineSharedQuotation(client, token, { name: String(body.name ?? ""), reason: String(body.reason ?? "") }));
}
