"use client";

// Invite someone new to the workspace from the screen that needs them (Create-Where-You-Are POS2, PJ3): their email and the role they get,
// sent through the same invitation as Settings › Users (seats and role rules apply there). They join when they accept the email; the form
// that needed them lists them from then on.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Dialog, Select, TextField } from "@vercentlabs/design-system";

import { getAccessOptions } from "@/features/settings/access/api/access-api";
import { createInvitation } from "@/features/settings/invitations/api/invitations-api";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

/** Whether this person may invite users. */
export function useCanInvite() {
  const workspace = useWorkspaceContext();
  return workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("users.manage");
}

export function InviteUserDialog({ suggestedRole, onClose, onSent }: {
  /** A role name to choose first (for example "Cashier"), when the company has it. */
  suggestedRole?: string;
  onClose: () => void;
  onSent: (email: string) => void;
}) {
  const options = useQuery({ queryKey: ["settings", "access", "options"], queryFn: getAccessOptions });
  const roles = (options.data?.roles ?? []).filter((role) => role.grantable);
  const suggested = suggestedRole ? roles.find((role) => role.name.toLowerCase().includes(suggestedRole.toLowerCase())) : undefined;
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState("");
  const chosenRole = roleId || suggested?.id || "";
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && Boolean(chosenRole);
  const send = useMutation({
    mutationFn: () => createInvitation({ email: email.trim().toLowerCase(), roleIds: [chosenRole], primaryRoleId: chosenRole }),
    onSuccess: () => onSent(email.trim().toLowerCase()),
  });
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => !open && onClose()} title="Invite a person">
      <div className="flex flex-col gap-3">
        <p className="text-sm text-text-secondary">They get an email to join the company with their own sign-in. A new user takes a seat on your subscription.</p>
        <TextField label="Email" type="email" isRequired autoFocus value={email} onChange={setEmail} />
        <Select label="Role" isRequired selectedKey={chosenRole || null} onSelectionChange={(key) => setRoleId(String(key ?? ""))} placeholder={options.isLoading ? "Loading roles…" : "Choose a role"}
          options={roles.map((role) => ({ value: role.id, label: role.name }))} />
        {send.isError && <p role="alert" className="text-sm text-danger">{send.error instanceof Error ? send.error.message : "The invitation could not be sent."}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isDisabled={!valid} isLoading={send.isPending} onPress={() => send.mutate()}>Send invitation</Button>
        </div>
      </div>
    </Dialog>
  );
}
