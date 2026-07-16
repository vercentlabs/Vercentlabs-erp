import { getSessionContext, setSessionOrganization } from "@/lib/auth";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOrigin, audit } from "@/lib/security";
import { organizationContextSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session) throw new HttpError(401, "Sign in to continue.");

    const input = organizationContextSchema.parse(await readJson(request));
    const changed = await setSessionOrganization(
      session.sessionId,
      session.userId,
      input.organizationId,
    );
    if (!changed) {
      throw new HttpError(
        403,
        "This organisation is outside your active membership scope.",
      );
    }

    await audit({
      organizationId: input.organizationId,
      actorUserId: session.userId,
      eventType: "workspace.organization_changed",
      entityType: "session",
      entityId: session.sessionId,
      beforeData: { organizationId: session.organizationId },
      afterData: { organizationId: input.organizationId },
      request,
    });

    const response = ok({
      message: "Organisation context updated.",
      next: "/dashboard",
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
