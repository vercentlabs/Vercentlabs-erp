"use client";

import { Button, Dialog, Select } from "@vercentlabs/design-system";
import type { Dispatch, SetStateAction } from "react";

// New privacy (data-subject) request for this Lead.
export function LeadPrivacyRequestDialog({
  privacyRequestOpen,
  setPrivacyRequestOpen,
  privacyRequestType,
  setPrivacyRequestType,
  actionError,
  privacyRequestMutation,
}: {
  privacyRequestOpen: boolean;
  setPrivacyRequestOpen: Dispatch<SetStateAction<boolean>>;
  privacyRequestType: string;
  setPrivacyRequestType: Dispatch<SetStateAction<string>>;
  actionError: string | null;
  privacyRequestMutation: { mutate: () => void; isPending: boolean };
}) {
  return (
    <Dialog
      isOpen={privacyRequestOpen}
      onOpenChange={setPrivacyRequestOpen}
      title="New privacy request for this Lead"
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Request type"
          options={[
            { value: "access", label: "Access" },
            { value: "export", label: "Export" },
            { value: "correction", label: "Correction" },
            { value: "deletion", label: "Deletion" },
            { value: "restriction", label: "Restriction" },
            { value: "consent_withdrawal", label: "Consent withdrawal" },
          ]}
          selectedKey={privacyRequestType}
          onSelectionChange={(key) =>
            setPrivacyRequestType(String(key ?? "export"))
          }
        />
        <p className="text-xs text-text-muted">
          Review, verify identity and execute the request from CRM Settings
          &rsaquo; Data Subject Requests.
        </p>
        {actionError && (
          <p role="alert" className="text-sm text-danger">
            {actionError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onPress={() => setPrivacyRequestOpen(false)}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onPress={() => privacyRequestMutation.mutate()}
            isLoading={privacyRequestMutation.isPending}
          >
            Create request
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
