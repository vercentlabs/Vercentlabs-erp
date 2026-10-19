import { listSocialIdentities, socialSignInProviders, unlinkSocialIdentity } from "@vercentlabs/api";

import { identityTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";
import { requireApiUser } from "@/core/session";

// Profile › Sign-in accounts: the Google / Microsoft accounts the person can sign in with.
export async function GET() {
  try {
    const session = await requireApiUser();
    const identities = await identityTransaction(session.userId, (client) => listSocialIdentities(client, session.userId));
    return ok({ identities, providers: socialSignInProviders(process.env) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await requireApiUser();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new HttpError(400, "Choose the account to unlink.");
    return ok(await identityTransaction(session.userId, (client) => unlinkSocialIdentity(client, session.userId, id)));
  } catch (error) {
    return errorResponse(error);
  }
}
