"use client";

// One member's actions behind ⋯ (Shared Platform plan 3): Change role first, then sign out everywhere, reset two-step sign-in (a lost
// phone), make owner — and Disable / Enable, last and in red. Your own row offers Change role only. Each opens its own confirmation; the
// server re-checks every permission.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { Button, Dialog, IconButton, Menu, MenuItem, MenuSeparator, MenuTrigger, TextField } from "@vercentlabs/design-system";

import { resetMemberMfa, signOutMember, transferOwnership } from "@/features/settings/company/company-api";
import { IdentityField } from "@/shared/ui/IdentityField";
import { Notice } from "@/shared/ui/Panel";

type Member = { user_id: string; full_name: string; membership_role: string; membership_status: string };
type Action = "mfa" | "signout" | "owner";

export function MemberActionsMenu({ member, isSelf, isOwner, isAdmin, canManageUsers, onManageRoles, onToggleStatus, onMessage }: {
  member: Member; isSelf: boolean; isOwner: boolean; isAdmin: boolean; canManageUsers: boolean; onManageRoles?: () => void; onToggleStatus: () => void;
  onMessage: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const close = () => { setAction(null); setReason(""); setPassword(""); };
  const run = useMutation({
    mutationFn: async (chosen: Action) => {
      if (chosen === "mfa") { await resetMemberMfa(member.user_id, reason); return `${member.full_name}'s two-step sign-in was reset; they set it up again at their next sign-in.`; }
      if (chosen === "signout") { const result = await signOutMember(member.user_id); return `${member.full_name} was signed out of ${result.sessionsSignedOut} session${result.sessionsSignedOut === 1 ? "" : "s"}.`; }
      await transferOwnership({ targetUserId: member.user_id, password });
      return `${member.full_name} is now the owner. You are a system administrator.`;
    },
    onSuccess: (text, chosen) => { onMessage(text); close(); void queryClient.invalidateQueries({ queryKey: ["settings", "users"] }); if (chosen === "owner") window.location.reload(); },
  });

  // The owner's own account help is the owner's alone; a disabled member can only be enabled again.
  const active = member.membership_status === "active";
  const security = !isSelf && active && (member.membership_role !== "owner" || isOwner);
  const items = [
    security && canManageUsers && { id: "signout", label: "Sign out everywhere" },
    security && (isOwner || isAdmin) && { id: "mfa", label: "Reset two-step sign-in" },
    security && isOwner && member.membership_role !== "owner" && { id: "owner", label: "Make owner" },
  ].filter(Boolean) as Array<{ id: Action; label: string }>;
  const canToggle = !isSelf && canManageUsers && member.membership_role !== "owner";
  if (!onManageRoles && !items.length && !canToggle) return null;

  const titles: Record<Action, string> = { mfa: "Reset two-step sign-in?", signout: "Sign out everywhere?", owner: `Make ${member.full_name} the owner?` };
  return (
    <>
      <MenuTrigger>
        <IconButton aria-label={`More actions for ${member.full_name}`} variant="ghost" size="compact"><MoreHorizontal className="size-4" aria-hidden="true" /></IconButton>
        <Menu onAction={(id) => (id === "roles" ? onManageRoles?.() : id === "status" ? onToggleStatus() : setAction(id as Action))}>
          {onManageRoles && <MenuItem id="roles">Change role</MenuItem>}
          {onManageRoles && (items.length > 0 || canToggle) && <MenuSeparator />}
          {items.map((item) => <MenuItem key={item.id} id={item.id}>{item.label}</MenuItem>)}
          {items.length > 0 && canToggle && <MenuSeparator />}
          {canToggle && <MenuItem id="status" isDanger={active}>{active ? "Disable user" : "Enable user"}</MenuItem>}
        </Menu>
      </MenuTrigger>
      <Dialog isOpen={action !== null} onOpenChange={(open) => !open && close()} title={action ? titles[action] : ""}
        footer={(
          <>
            <Button variant="secondary" onPress={close}>Cancel</Button>
            <Button variant={action === "owner" ? "danger" : "primary"} isLoading={run.isPending} isDisabled={action === "owner" && !password} onPress={() => action && run.mutate(action)}>
              {action === "mfa" ? "Reset" : action === "signout" ? "Sign out" : "Make owner"}
            </Button>
          </>
        )}>
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
        </div>
      </Dialog>
    </>
  );
}
