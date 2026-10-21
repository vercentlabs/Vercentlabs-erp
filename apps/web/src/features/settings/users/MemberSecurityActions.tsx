"use client";

// Account help for one member (Shared Platform plan 3): reset two-step sign-in (a lost phone), sign out everywhere, and — for the
// owner — hand over ownership. The server re-checks every permission.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, TextField } from "@vercentlabs/design-system";

import { IdentityField } from "@/shared/ui/IdentityField";

import { resetMemberMfa, signOutMember, transferOwnership } from "@/features/settings/company/company-api";
import { Notice } from "@/shared/ui/Panel";

type Member = { user_id: string; full_name: string; membership_role: string; membership_status: string };
type Action = "mfa" | "signout" | "owner" | null;

export function MemberSecurityActions({ member, isOwner, isAdmin, canManageUsers }: { member: Member; isOwner: boolean; isAdmin: boolean; canManageUsers: boolean }) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<Action>(null);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const close = () => { setAction(null); setReason(""); setPassword(""); };
  const run = useMutation({
    mutationFn: async () => {
      if (action === "mfa") { await resetMemberMfa(member.user_id, reason); return `${member.full_name}'s two-step sign-in was reset; they set it up again at their next sign-in.`; }
      if (action === "signout") { const result = await signOutMember(member.user_id); return `${member.full_name} was signed out of ${result.sessionsSignedOut} session${result.sessionsSignedOut === 1 ? "" : "s"}.`; }
      await transferOwnership({ targetUserId: member.user_id, password });
      return `${member.full_name} is now the owner. You are a system administrator.`;
    },
    onSuccess: (text) => { setDone(text); close(); void queryClient.invalidateQueries({ queryKey: ["settings", "users"] }); if (action === "owner") window.location.reload(); },
  });
  if (member.membership_status !== "active" || member.membership_role === "owner" && !isOwner) return null;
  const titles = { mfa: "Reset two-step sign-in?", signout: "Sign out everywhere?", owner: `Make ${member.full_name} the owner?` };
  return (
    <>
      {(isOwner || isAdmin) && <Button variant="ghost" size="compact" onPress={() => setAction("mfa")}>Reset two-step sign-in</Button>}
      {canManageUsers && <Button variant="ghost" size="compact" onPress={() => setAction("signout")}>Sign out</Button>}
      {isOwner && member.membership_role !== "owner" && <Button variant="ghost" size="compact" onPress={() => setAction("owner")}>Make owner</Button>}
      {done && <span className="text-xs text-success">{done}</span>}
      <Dialog isOpen={action !== null} onOpenChange={(open) => !open && close()} title={action ? titles[action] : ""}>
        <div className="flex flex-col gap-3 text-sm">
          {run.error && <Notice>{run.error instanceof Error ? run.error.message : "That did not work."}</Notice>}
          {action === "mfa" && (
            <>
              <p>Their authenticator app is removed and they are signed out. They set it up again the next time they sign in.</p>
              <TextField label="Reason (for the record)" value={reason} onChange={setReason} maxLength={300} />
            </>
          )}
          {action === "signout" && <p>Every session they have ends now. Their account stays active.</p>}
          {action === "owner" && (
            <>
              <p>They can then manage billing, users and the company&apos;s data, and close the workspace. You become a system administrator. There is one owner at a time.</p>
              <IdentityField value={password} onChange={setPassword} />
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={close}>Cancel</Button>
            <Button variant={action === "owner" ? "danger" : "primary"} isLoading={run.isPending} isDisabled={action === "owner" && !password} onPress={() => run.mutate()}>
              {action === "mfa" ? "Reset" : action === "signout" ? "Sign out" : "Make owner"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
