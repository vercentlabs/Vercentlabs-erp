import { errorResponse, ok } from "@/core/http";
import { requireTenantApiScope } from "@/core/shared-platform";

export async function GET(request: Request) {
  try {
    const principal = await requireTenantApiScope(request, "platform.context.read");
    return ok({
      apiVersion: "v1",
      organizationId: principal.organization_id,
      developerAppId: principal.developer_app_id,
      scopes: principal.scopes,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
