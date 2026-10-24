import { acceptSharedQuotation } from "@vercentlabs/api";

import { sharedAnswer } from "../../../shared-answer";

// The customer accepts a shared quotation: { name, signature (PNG data URL), note? }.
export async function POST(request: Request, route: { params: Promise<{ token: string }> }) {
  const { token } = await route.params;
  return sharedAnswer(request, token, "The acceptance could not be recorded. Try again.", (client, body) =>
    acceptSharedQuotation(client, token, { name: String(body.name ?? ""), note: String(body.note ?? ""), signature: String(body.signature ?? ""),
      optionalChosen: Array.isArray(body.optionalChosen) ? body.optionalChosen.map(Number) : [] }));
}
