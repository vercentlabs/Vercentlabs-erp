"use client";

import {
  Button,
  Dialog,
  Select,
  type SelectOption,
} from "@vercentlabs/design-system";
import type { Dispatch, SetStateAction } from "react";
import type { Lead } from "../types";
import type { LeadDetailData } from "./useLeadDetailData";

// Convert dialog: the conversion preview with exact matches pre-selected by
// the screen, Account/Contact choice and the convert action.
export function ConvertLeadDialog({
  lead,
  convertPreviewOpen,
  handleConvertPreviewOpenChange,
  convertPreviewQuery,
  accountChoiceOptions,
  contactChoiceOptions,
  contactCandidates,
  convertPartyId,
  setConvertPartyId,
  convertContactId,
  setConvertContactId,
  actionError,
  convertMutation,
}: {
  lead: Lead;
  convertPreviewOpen: boolean;
  handleConvertPreviewOpenChange: (open: boolean) => void;
  convertPreviewQuery: LeadDetailData["convertPreviewQuery"];
  accountChoiceOptions: SelectOption[];
  contactChoiceOptions: SelectOption[];
  contactCandidates: NonNullable<
    LeadDetailData["convertPreviewQuery"]["data"]
  >["contactCandidates"];
  convertPartyId: string;
  setConvertPartyId: Dispatch<SetStateAction<string>>;
  convertContactId: string;
  setConvertContactId: Dispatch<SetStateAction<string>>;
  actionError: string | null;
  convertMutation: { mutate: () => void; isPending: boolean };
}) {
  return (
    <Dialog
      isOpen={convertPreviewOpen}
      onOpenChange={handleConvertPreviewOpenChange}
      title="Convert this Lead"
    >
      <div className="flex flex-col gap-4">
        {lead.qualificationState !== "qualified" ? (
          <p
            role="status"
            className="rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2 text-sm text-warning"
          >
            Only a qualified Lead can be converted. Record a qualification
            decision on the Qualification tab first.
          </p>
        ) : convertPreviewQuery.isLoading ? (
          <p className="text-sm text-text-secondary">
            Checking for existing Accounts and Contacts…
          </p>
        ) : (
          <>
            <p className="text-sm text-text-secondary">
              Review any existing Account/Contact this Lead might match before
              converting. An exact match is pre-selected; choose &ldquo;Create a
              new&hellip;&rdquo; to make a new record instead.
            </p>
            <Select
              label="Account"
              options={accountChoiceOptions}
              selectedKey={convertPartyId}
              onSelectionChange={(key) => {
                const nextPartyId = String(key ?? "");
                setConvertPartyId(nextPartyId);
                if (
                  !contactCandidates.some(
                    (row) =>
                      row.id === convertContactId &&
                      row.party_id === nextPartyId,
                  )
                )
                  setConvertContactId("");
              }}
            />
            <Select
              label="Contact"
              options={contactChoiceOptions}
              selectedKey={convertContactId}
              onSelectionChange={(key) =>
                setConvertContactId(String(key ?? ""))
              }
            />
            {!convertPartyId && contactCandidates.length > 0 && (
              <p className="text-xs text-text-muted">{`${contactCandidates.length} similar contact${contactCandidates.length === 1 ? " exists" : "s exist"} under other accounts; a new Contact is created under the new Account.`}</p>
            )}
          </>
        )}
        {actionError && (
          <p role="alert" className="text-sm text-danger">
            {actionError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onPress={() => handleConvertPreviewOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onPress={() => convertMutation.mutate()}
            isLoading={convertMutation.isPending}
            isDisabled={
              lead.qualificationState !== "qualified" ||
              convertPreviewQuery.isLoading
            }
          >
            Convert
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
