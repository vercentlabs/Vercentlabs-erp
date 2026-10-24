import { verifyPortalCode } from "@vercentlabs/api";

import { portalAnswer, portalCookie } from "../portal-route";

// The code typed: signs the customer in for 7 days (an httpOnly cookie for this portal only).
export async function POST(request: Request, route: { params: Promise<{ key: string }> }) {
  const { key } = await route.params;
  return portalAnswer(request, key, "You could not be signed in. Try again.",
    (client, body) => verifyPortalCode(client, key, { email: String(body.email ?? ""), code: String(body.code ?? "") }),
    (result) => {
      const session = result as { token: string; maxAgeSeconds: number };
      const response = Response.json({ ok: true });
      const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
      response.headers.append("set-cookie", `${portalCookie(key)}=${session.token}; Path=/p/${key}; Max-Age=${session.maxAgeSeconds}; HttpOnly; SameSite=Lax${secure}`);
      return response;
    });
}
