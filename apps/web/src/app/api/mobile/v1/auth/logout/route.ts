import { audit } from "@/lib/security";
import { mobileError, mobileOk } from "@/lib/mobile-http";
import {
  requireMobileSession,
  revokeMobileSession,
} from "@/lib/mobile-session";

export async function POST(request: Request) {
  try {
    const session = await requireMobileSession(request);
    await revokeMobileSession(request);
    await audit({
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: "auth.mobile_logout",
      entityType: "session",
      entityId: session.sessionId,
      request,
    });
    return mobileOk(request, { message: "Signed out securely." });
  } catch (error) {
    return mobileError(request, error);
  }
}
