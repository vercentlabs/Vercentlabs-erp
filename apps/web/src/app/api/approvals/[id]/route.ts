import { requirePermission } from "@/lib/authorization";
import { errorResponse, HttpError } from "@/lib/http";
import { assertSameOrigin } from "@/lib/security";

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    await requirePermission("approvals.manage");
    throw new HttpError(
      501,
      "Approval decisions are disabled until each request is bound to an executable, transactional business command.",
    );
  } catch (error) {
    return errorResponse(error);
  }
}
