import "server-only";

import { ingressTransaction } from "@/core/db";
import { enforcePublicRateLimits } from "@/core/public-rate-limit";

type Client = Parameters<Parameters<typeof ingressTransaction>[0]>[0];

// The cookie that keeps a customer signed in to one company's portal (Sales report Phase 3).
export const portalCookie = (key: string) => `vl_portal_${key.slice(0, 12)}`;

// A portal request: limited per address and per portal, run in the company's transaction; a refusal becomes a message to act on.
export async function portalAnswer(request: Request, key: string, failure: string, run: (client: Client, body: Record<string, unknown>) => Promise<unknown>,
  respond: (result: unknown) => Response = () => Response.json({ ok: true })) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    await enforcePublicRateLimits(request, [
      { bucket: "sales-portal", maximum: 15, windowSeconds: 600 },
      { bucket: "sales-portal-key", maximum: 200, windowSeconds: 3600, subject: key },
    ]);
    const result = await ingressTransaction((client) => run(client, body));
    if (!result) return Response.json({ ok: false, message: "This portal address is not valid." }, { status: 404 });
    return respond(result);
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? Number((error as { status: number }).status) : 500;
    const known = status >= 400 && status < 500;
    return Response.json({ ok: false, message: known ? (error as Error).message : failure }, { status: known ? status : 500 });
  }
}
