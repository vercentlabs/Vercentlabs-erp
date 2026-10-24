import { cookies } from "next/headers";
import { signOutOfPortal } from "@vercentlabs/api";

import { portalAnswer, portalCookie } from "../portal-route";

export async function POST(request: Request, route: { params: Promise<{ key: string }> }) {
  const { key } = await route.params;
  const token = (await cookies()).get(portalCookie(key))?.value ?? null;
  return portalAnswer(request, key, "You could not be signed out. Try again.", (client) => signOutOfPortal(client, key, token), () => {
    const response = Response.json({ ok: true });
    response.headers.append("set-cookie", `${portalCookie(key)}=; Path=/p/${key}; Max-Age=0; HttpOnly; SameSite=Lax`);
    return response;
  });
}
