import { z } from "zod";

import { errorResponse, HttpError, ok, readJson } from "@/core/http";

// A local, explicit capture adapter for auth-flow E2E tests (Phase 2A/2B):
// deliverAuthMessage's webhook path can be pointed at this route in a
// dev/test environment (AUTH_EMAIL_WEBHOOK_URL) so a test can retrieve the
// EXACT url/content that would have been emailed, without ever
// reconstructing it or logging real tokens to a shared log stream.
// Hard-blocked in production by TWO independent checks (NODE_ENV and an
// explicit opt-in flag) — this route has no authentication of its own,
// so it must be structurally unreachable in a real deployment rather than
// merely "not used" there.
function guardTestSupportRoute() {
  if (process.env.NODE_ENV === "production" || process.env.AUTH_EMAIL_CAPTURE_ENABLED !== "1") {
    throw new HttpError(404, "Not found.");
  }
}

const MAX_MESSAGES_PER_EMAIL = 5;
const captured = new Map<string, Array<{ type: string; url: string; organizationName?: string; capturedAt: string }>>();

const messageSchema = z.object({
  type: z.string(),
  email: z.string().email(),
  url: z.string().url(),
  organizationName: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    guardTestSupportRoute();
    const body = messageSchema.parse(await readJson(request));
    const key = body.email.toLowerCase();
    const list = captured.get(key) ?? [];
    list.push({ type: body.type, url: body.url, organizationName: body.organizationName, capturedAt: new Date().toISOString() });
    while (list.length > MAX_MESSAGES_PER_EMAIL) list.shift();
    captured.set(key, list);
    return ok({ received: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  try {
    guardTestSupportRoute();
    const email = new URL(request.url).searchParams.get("email");
    if (!email) throw new HttpError(400, "email query parameter is required.");
    const list = captured.get(email.toLowerCase()) ?? [];
    return ok({ message: list.length > 0 ? list[list.length - 1] : null });
  } catch (error) {
    return errorResponse(error);
  }
}
