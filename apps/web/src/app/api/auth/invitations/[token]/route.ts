import { getInvitationByToken } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";

// Public by design — the acceptance page needs to show the organization
// name and role before the invitee has any session at all. The token
// itself (a 32-byte random value, never guessable) is the only
// credential; no email/password is exposed by this lookup.
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const invitation = await withClient((client) => getInvitationByToken(client, token));
    return ok({
      organizationName: invitation.organization_name,
      roleName: invitation.role_name,
      email: invitation.email,
      expiresAt: invitation.expires_at,
      hasExistingAccount: invitation.has_existing_account,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
