import { acceptSharedQuotation } from "@vercentlabs/api";

import { ingressTransaction } from "@/core/db";

// The customer accepts a shared quotation: { name, note? }. No sign-in: the token in the link is the credential.
export async function POST(request: Request, route: { params: Promise<{ token: string }> }) {
  const { token } = await route.params;
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; note?: unknown };
  try {
    const result = await ingressTransaction((client) => acceptSharedQuotation(client, token, { name: String(body.name ?? ""), note: String(body.note ?? "") }));
    if (!result) return Response.json({ ok: false, message: "This link is not valid." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? Number((error as { status: number }).status) : 500;
    const known = status >= 400 && status < 500;
    return Response.json({ ok: false, message: known ? (error as Error).message : "The acceptance could not be recorded. Try again." }, { status: known ? status : 500 });
  }
}
