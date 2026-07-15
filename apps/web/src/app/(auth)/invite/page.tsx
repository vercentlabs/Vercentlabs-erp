import Link from "next/link";
import AuthCard from "@/components/auth-card";
import AcceptInvitationForm from "@/components/accept-invitation-form";
import { tokenHash } from "@/lib/auth";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accept invitation" };

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  const rows = token
    ? await query<{
        email: string;
        organization_name: string;
        role_name: string;
        existing_user: boolean;
      }>(
        `
    SELECT i.email, o.name AS organization_name, r.name AS role_name,
      EXISTS(SELECT 1 FROM users u WHERE u.email=i.email) AS existing_user
    FROM organization_invitations i
    JOIN organizations o ON o.id=i.organization_id
    JOIN roles r ON r.id=i.role_id
    WHERE i.token_hash=$1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now()
  `,
        [tokenHash(token)],
      )
    : [];
  const invite = rows[0];
  return (
    <AuthCard
      eyebrow="Organisation invitation"
      title={
        invite ? `Join ${invite.organization_name}` : "Invitation unavailable"
      }
      description={
        invite
          ? `You have been invited as ${invite.role_name}.`
          : "The invitation link is invalid, expired or already used."
      }
      footer={<Link href="/login">Return to sign in</Link>}
    >
      {invite ? (
        <AcceptInvitationForm
          token={token}
          email={invite.email}
          existingUser={invite.existing_user}
        />
      ) : (
        <p className="notice error">
          Ask the organisation administrator to send a new invitation.
        </p>
      )}
    </AuthCard>
  );
}
