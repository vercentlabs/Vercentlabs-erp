import { z } from "zod";

import { assertSameOrigin, clientIp, enforceRateLimit, readSignupWebsite, startSignup } from "@vercentlabs/api";

import { ingressTransaction, withIngressClient } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { setSignupCookie } from "@/features/auth/signup-cookie";
import { createLogger } from "@vercentlabs/observability";

const schema = z.object({ fullName: z.string().max(200), email: z.string().max(320), companyName: z.string().max(200), website: z.string().max(500).optional(), timezone: z.string().max(100).optional() });

// Screen 1: checks the 4 details, sends the code, and starts reading the website in the background (the person checks their email
// meanwhile). 5 signups an hour from one address.
export async function POST(request: Request) {
  try {
    assertSameOrigin(request, process.env);
    const body = schema.parse(await readJson(request));
    const ip = clientIp(request, process.env);
    await withIngressClient((client) => enforceRateLimit(client, `signup:${ip}`, 5, 3600));
    const started = await ingressTransaction((client) => startSignup(client, body, { ipAddress: ip, env: process.env }));
    if (started.website) {
      void readSignupWebsite((handler) => ingressTransaction(handler), started.signupId, { env: process.env })
        .catch((error) => createLogger("signup").warn("reading the website failed", { error: String(error?.message ?? error).slice(0, 200) }));
    }
    const response = ok({ email: started.email, resendAfterSeconds: 30 });
    setSignupCookie(response, started.token);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
