import "server-only";

import { ingressTransaction } from "@/core/db";
import { enforcePublicRateLimits } from "@/core/public-rate-limit";

type Client = Parameters<Parameters<typeof ingressTransaction>[0]>[0];

// The customer's answer on a shared link: runs it in the company's transaction and turns a refusal into a message they can act on. No
// sign-in: the token in the link is the credential, so answers are limited per address and per link.
export async function sharedAnswer(request: Request, token: string, failure: string, run: (client: Client, body: Record<string, unknown>) => Promise<unknown>) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    await enforcePublicRateLimits(request, [
      { bucket: "sales-link-answer", maximum: 20, windowSeconds: 600 },
      { bucket: "sales-link-answer-token", maximum: 10, windowSeconds: 3600, subject: token },
    ]);
    const result = await ingressTransaction((client) => run(client, body));
    if (!result) return Response.json({ ok: false, message: "This link is not valid." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? Number((error as { status: number }).status) : 500;
    const known = status >= 400 && status < 500;
    return Response.json({ ok: false, message: known ? (error as Error).message : failure }, { status: known ? status : 500 });
  }
}
