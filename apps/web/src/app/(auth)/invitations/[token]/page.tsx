import { AuthLifecycleError, getInvitationByToken } from "@vercentlabs/api";

import { withIngressClient } from "@/core/db";
import { getSessionContext } from "@/core/session";
import { AcceptInvitationForm } from "./accept-invitation-form";

export const metadata = { title: "Accept invitation" };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let invitation: Awaited<ReturnType<typeof getInvitationByToken>> | null = null;
  let error: string | null = null;
  try {
    invitation = await withIngressClient((client) => getInvitationByToken(client, token));
  } catch (caught) {
    error = caught instanceof AuthLifecycleError ? caught.message : "This invitation link is invalid.";
  }

  // getSessionContext(), not requireUser() — visiting an invitation link
  // while signed out is the normal case for a brand-new account, so this
  // must not redirect anyone away. For an existing account, whether the
  // visitor is ALREADY signed in as that exact email is what decides
  // whether the form can accept immediately or must send them to sign in
  // first — mirrors the same rule the accept endpoint enforces server-side.
  const currentSession = invitation?.has_existing_account ? await getSessionContext() : null;
  const alreadySignedInAsInvitee = Boolean(
    currentSession && currentSession.email.toLowerCase() === invitation?.email.toLowerCase(),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold tracking-wide text-text-muted uppercase">Vercentlabs ERP</p>
        <h1 className="text-xl font-semibold text-text">
          {invitation ? `Join ${invitation.organization_name}` : "Invitation"}
        </h1>
        {invitation ? (
          <p className="text-sm text-text-secondary">
            {invitation.email}
            {invitation.role_name ? ` · ${invitation.role_name}` : ""}
          </p>
        ) : null}
      </div>
      {invitation ? (
        <AcceptInvitationForm
          token={token}
          hasExistingAccount={invitation.has_existing_account}
          alreadySignedInAsInvitee={alreadySignedInAsInvitee}
        />
      ) : (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
