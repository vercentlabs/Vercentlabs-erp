import { listPendingInvitationsForEmail } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { requireVerifiedUser } from "@/core/session";
import { SignOutLink } from "./sign-out-link";

export const metadata = { title: "Join an organization" };

// Reached when a verified user has no active organization membership at
// all — per SP004's flow ("Invite -> verify -> join organization"), the
// only way into a workspace is an invitation from an existing
// organization; there is no self-service "create your own organization"
// signup in this product. This page's job is to tell that person exactly
// what's true right now (a pending invitation exists, or none does),
// never to fabricate a next step that isn't real.
export default async function OnboardingPage() {
  const session = await requireVerifiedUser();
  const invitations = await withClient((client) => listPendingInvitationsForEmail(client, session.email));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold tracking-wide text-text-muted uppercase">Vercentlabs ERP</p>
        <h1 className="text-xl font-semibold text-text">You&apos;re not part of an organization yet</h1>
      </div>
      {invitations.length > 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text">
            You have {invitations.length === 1 ? "a pending invitation" : `${invitations.length} pending invitations`}:
          </p>
          <ul className="flex flex-col gap-2">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="rounded-[var(--radius-card)] border border-border bg-surface p-3 text-sm text-text">
                <strong>{invitation.organization_name}</strong>
                <p className="text-text-secondary">Check {session.email} for the invitation link to accept it.</p>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-text-secondary">
          No one has invited {session.email} to an organization yet. Ask your administrator to send an invitation to this
          email address, then refresh this page.
        </p>
      )}
      <SignOutLink />
    </div>
  );
}
