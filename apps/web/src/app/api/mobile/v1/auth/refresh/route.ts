import { z } from "zod";

import { getMobileSessionContext } from "@/core/auth";
import { HttpError, readJson } from "@/core/http";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { publicSession, rotateMobileSession } from "@/core/mobile-session";
import { clientIp, enforceRateLimit, sha256 } from "@/core/security";

const inputSchema = z.object({
  refreshToken: z.string().min(40).max(200),
});

export async function POST(request: Request) {
  try {
    const input = inputSchema.parse(await readJson(request));
    await enforceRateLimit(`mobile-refresh-ip:${clientIp(request)}`, 120, 900);
    await enforceRateLimit(
      `mobile-refresh-token:${sha256(input.refreshToken).slice(0, 24)}`,
      20,
      900,
    );
    const rotated = await rotateMobileSession(input.refreshToken, request);
    const context = await getMobileSessionContext(rotated.tokens.accessToken);
    if (!context) throw new HttpError(401, "Your mobile session has expired.");
    return mobileOk(request, {
      accessToken: rotated.tokens.accessToken,
      refreshToken: rotated.tokens.refreshToken,
      accessExpiresAt: rotated.tokens.accessExpiresAt.toISOString(),
      refreshExpiresAt: rotated.tokens.refreshExpiresAt.toISOString(),
      session: publicSession(context),
    });
  } catch (error) {
    return mobileError(request, error);
  }
}
