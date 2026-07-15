import { clearSessionCookie, revokeCurrentSession } from "@/lib/auth";
import { errorResponse, ok } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await revokeCurrentSession("logout");
    const response = ok({ message: "Signed out.", next: "/login" });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
