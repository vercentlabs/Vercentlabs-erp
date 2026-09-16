"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, Select, type SelectOption } from "@vercentlabs/design-system";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { createPrivacyRequest, PrivacyApiError } from "@/features/crm/settings/privacy/api/privacy-api";

const REQUEST_TYPE_OPTIONS: SelectOption[] = [
  { value: "access", label: "Access" },
  { value: "export", label: "Export" },
  { value: "correction", label: "Correction" },
  { value: "restriction", label: "Restriction" },
  { value: "erasure", label: "Erasure" },
  { value: "consent_withdrawal", label: "Consent withdrawal" },
];

// F002 Stage A2 §13. A single, narrow entry point into the shared
// PLATFORM privacy authority (core/privacy.js) from Account 360 —
// gated by platform.privacy.manage, NOT crm.accounts.manage, so an
// ordinary CRM user who can view/edit this Account does not thereby
// gain privacy-administration authority. Hidden entirely (not just
// disabled) for anyone without the permission, matching this prompt's
// own "ordinary REP users must not gain privacy-administration
// authority merely because they can view an Account" instruction.
export function AccountPrivacyPanel({ accountId, accountName }: { accountId: string; accountName: string }) {
  const workspace = useWorkspaceContext();
  const canManage = workspace.permissions.includes(CORE_PERMISSIONS.platformPrivacyManage);
  const [open, setOpen] = useState(false);
  const [requestType, setRequestType] = useState("access");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState(false);

  const mutation = useMutation({
    mutationFn: () => createPrivacyRequest({ requestType, subjectReference: `account:${accountId}` }),
    onSuccess: () => {
      setError(null);
      setCreated(true);
    },
    onError: (err: unknown) => setError(err instanceof PrivacyApiError ? err.message : "This request could not be created."),
  });

  if (!canManage) return null;

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">Privacy</span>
        <Button
          variant="secondary"
          size="compact"
          onPress={() => {
            setCreated(false);
            setError(null);
            setOpen(true);
          }}
        >
          Submit privacy request
        </Button>
      </div>
      <Dialog isOpen={open} onOpenChange={setOpen} title={`Submit a privacy request for ${accountName}`}>
        <div className="flex flex-col gap-4">
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {created ? (
            <p className="text-sm text-success">Request recorded. Track it in Settings → Privacy Administration.</p>
          ) : (
            <Select label="Request type" options={REQUEST_TYPE_OPTIONS} selectedKey={requestType} onSelectionChange={(key) => setRequestType(String(key ?? "access"))} />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onPress={() => setOpen(false)}>Close</Button>
            {!created && (
              <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending}>
                Submit request
              </Button>
            )}
          </div>
        </div>
      </Dialog>
    </div>
  );
}
