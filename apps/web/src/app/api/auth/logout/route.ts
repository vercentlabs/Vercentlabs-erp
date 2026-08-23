import { clearSessionCookie, revokeCurrentSession } from "@/core/auth";
import { errorResponse, ok } from "@/core/http";
import { assertSameOrigin } from "@/core/security";

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
