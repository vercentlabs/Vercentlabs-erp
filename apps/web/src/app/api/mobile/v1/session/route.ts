import { mobileError, mobileOk } from "@/core/mobile-http";
import { publicSession, requireMobileSession } from "@/core/mobile-session";

export async function GET(request: Request) {
  try {
    const session = await requireMobileSession(request);
    return mobileOk(request, { session: publicSession(session) });
  } catch (error) {
    return mobileError(request, error);
  }
}
