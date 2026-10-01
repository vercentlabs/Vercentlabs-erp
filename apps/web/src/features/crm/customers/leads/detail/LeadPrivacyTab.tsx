"use client";

import { ShieldAlert } from "lucide-react";
import { Button } from "@vercentlabs/design-system";
import type { Dispatch, SetStateAction } from "react";
import { formatDate, humanize } from "@/shared/format/human";
import type { LeadDetailData } from "./useLeadDetailData";

// Privacy tab: consent evidence and the entry point for a data-subject
// request about this Lead.
export function LeadPrivacyTab({
  consentQuery,
  canManageLeads,
  setPrivacyRequestOpen,
}: {
  consentQuery: LeadDetailData["consentQuery"];
  canManageLeads: boolean;
  setPrivacyRequestOpen: Dispatch<SetStateAction<boolean>>;
}) {
  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">
          Consent evidence and data-subject requests recorded for this Lead. See
          CRM Settings &rsaquo; Data Subject Requests to review and execute a
          request.
        </p>
        {canManageLeads && (
          <Button
            variant="secondary"
            size="compact"
            onPress={() => setPrivacyRequestOpen(true)}
          >
            <ShieldAlert className="size-4" aria-hidden="true" />
            New privacy request
          </Button>
        )}
      </div>
      {consentQuery.isLoading && (
        <p className="text-sm text-text-secondary">Loading consent history…</p>
      )}
      {consentQuery.isSuccess &&
        (consentQuery.data.rows.length === 0 ? (
          <p className="text-sm text-text-secondary">
            No consent events recorded for this Lead yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {consentQuery.data.rows.map((event) => (
              <li
                key={event.id}
                className="flex items-center justify-between gap-2 text-sm text-text-secondary"
              >
                <span>{`${humanize(event.channel)} ${event.action} (${humanize(event.source)})`}</span>
                <span className="shrink-0 text-xs tabular-nums">
                  {formatDate(event.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
