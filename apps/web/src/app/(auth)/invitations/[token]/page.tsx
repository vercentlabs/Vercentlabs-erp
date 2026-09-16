import { AuthLifecycleError, getInvitationByToken } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { AcceptInvitationForm } from "./accept-invitation-form";

export const metadata = { title: "Accept invitation" };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let invitation: Awaited<ReturnType<typeof getInvitationByToken>> | null = null;
  let error: string | null = null;
  try {
    invitation = await withClient((client) => getInvitationByToken(client, token));
  } catch (caught) {
    error = caught instanceof AuthLifecycleError ? caught.message : "This invitation link is invalid.";
  }

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
        <AcceptInvitationForm token={token} requiresPassword={!invitation.has_existing_account} />
      ) : (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
