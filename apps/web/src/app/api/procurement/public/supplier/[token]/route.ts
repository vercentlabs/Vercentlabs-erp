import { answerOrderOnSupplierPage, quoteOnSupplierPage } from "@vercentlabs/api";

import { supplierAnswer } from "../answer";

// The supplier's answer on their page: { action: confirm | propose (date, note?) | quote (lines, validUntil?, leadDays?, freight?, reference?, note?), name? }.
export async function POST(request: Request, route: { params: Promise<{ token: string }> }) {
  const { token } = await route.params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return supplierAnswer(request, token, "Your answer could not be recorded. Try again.", (client) =>
    body.action === "quote" ? quoteOnSupplierPage(client, token, body) : answerOrderOnSupplierPage(client, token, body));
}
