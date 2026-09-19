import Link from "next/link";

import { listPendingInvitationsForEmail } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { requireVerifiedUser } from "@/core/session";
import { SignOutLink } from "./sign-out-link";

export const metadata = { title: "Join an organization" };

// Reached when a verified user has no active organization membership at
// all. Two real ways forward exist: accept a pending invitation from an
// existing organization (SP004's "Invite -> verify -> join organization"
// flow), or create a new organization of their own via /register (added
// after this page's original "no self-service signup exists" copy, which
// is why the link below only appeared once that flow was real — this
// page's job is to tell the person exactly what's true right now, never
// to fabricate a next step that isn't real).
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
          email address, then refresh this page — or{" "}
          <Link href="/register" className="font-medium text-brand hover:underline">
            create your own organization
          </Link>{" "}
          instead.
        </p>
      )}
      <SignOutLink />
    </div>
  );
}
