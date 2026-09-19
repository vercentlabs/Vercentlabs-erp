import { redirect } from "next/navigation";

import { nextPath, requireVerifiedUser } from "@/core/session";
import { MfaVerifyClient } from "./mfa-verify-client";

export const metadata = { title: "Verify your identity" };

// The gate destination itself — must not call requireMfaVerifiedUser()
// (that would redirect right back here). If the caller lands here without
// actually needing this step (followed a stale link, already verified in
// another tab), send them on to wherever they really belong instead of
// showing a pointless form.
export default async function MfaVerifyPage() {
  const session = await requireVerifiedUser();
  const needsMfaStep = (session.mfaEnrolled || session.mfaPolicyRequired) && !session.mfaVerified;
  if (!needsMfaStep) redirect(nextPath(session));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold tracking-wide text-text-muted uppercase">Vercentlabs ERP</p>
        <h1 className="text-xl font-semibold text-text">Verify your identity</h1>
      </div>
      <MfaVerifyClient mfaEnrolled={session.mfaEnrolled} email={session.email} />
    </div>
  );
}
