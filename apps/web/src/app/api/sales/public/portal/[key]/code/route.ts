import { requestPortalCode } from "@vercentlabs/api";

import { portalAnswer } from "../portal-route";

// "Send me a code": the same answer whether or not the email belongs to a customer.
export async function POST(request: Request, route: { params: Promise<{ key: string }> }) {
  const { key } = await route.params;
  return portalAnswer(request, key, "The code could not be sent. Try again.", (client, body) => requestPortalCode(client, key, { email: String(body.email ?? "") }));
}
