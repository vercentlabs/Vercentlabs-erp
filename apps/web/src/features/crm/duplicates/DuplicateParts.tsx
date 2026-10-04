"use client";

// The pieces every duplicate warning shares: why a record matched, how
// strongly, and what the user may do about a strong match. Leads, contacts
// and accounts each render their own list of matches and use these.
import { Badge, Button, TextArea } from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

export type DuplicateReason = { signal: string; label: string; strong: boolean };
export type DuplicateMatchInfo = {
  signals: string[];
  strength: "exact" | "possible";
  reasons?: DuplicateReason[];
  isArchived?: boolean;
  isInactive?: boolean;
};

export function useCanOverrideDuplicates() {
  const workspace = useWorkspaceContext();
  return workspace.roleSlugs?.includes("organization_owner") || workspace.permissions.includes(CRM_PERMISSIONS.duplicatesOverride);
}

export function MatchStrengthBadge({ match }: { match: DuplicateMatchInfo }) {
  return <Badge tone={match.strength === "exact" ? "warning" : "neutral"}>{match.strength === "exact" ? "Strong match" : "Possible match"}</Badge>;
}

// Archived and inactive records are matched too, so they are restored
// instead of being created a second time.
export function MatchStateBadge({ match }: { match: DuplicateMatchInfo }) {
  if (match.isArchived) return <Badge tone="neutral">Archived — restore it instead</Badge>;
  if (match.isInactive) return <Badge tone="neutral">Inactive — reactivate it instead</Badge>;
  return null;
}

// "✓ Same email   ~ Similar name": a tick for an identifier that settles it,
// a tilde for a resemblance.
export function MatchReasons({ match }: { match: DuplicateMatchInfo }) {
  const reasons = match.reasons?.length ? match.reasons : match.signals.map((signal) => ({ signal, label: signal.replaceAll("_", " "), strong: match.strength === "exact" }));
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-secondary">
      {reasons.map((reason) => (
        <span key={reason.signal} className="whitespace-nowrap">
          <span aria-hidden="true" className={reason.strong ? "font-semibold text-warning" : "text-text-muted"}>{reason.strong ? "✓" : "~"} </span>
          {reason.label}
        </span>
      ))}
    </span>
  );
}

// What a strong match allows. Someone with the override permission may save
// anyway and must say why; everyone else uses the existing record.
export function DuplicateOverride({ subject, reason, onReasonChange, onConfirm, onCancel, isLoading }: {
  subject: string;
  reason: string;
  onReasonChange: (reason: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const canOverride = useCanOverrideDuplicates();
  if (!canOverride)
    return (
      <div className="flex flex-col gap-2">
        <p>Open the existing record and use it. If this really is a separate {subject}, ask a manager to create it.</p>
        <div><Button variant="outline" onPress={onCancel}>Go back and edit</Button></div>
      </div>
    );
  return (
    <div className="flex flex-col gap-3">
      <TextArea label={`Why is this a separate ${subject}?`} description="Kept with the record, so the next person knows it was checked." isRequired value={reason} onChange={onReasonChange} />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onPress={onConfirm} isLoading={isLoading} isDisabled={!reason.trim()}>Create anyway</Button>
        <Button variant="ghost" onPress={onCancel}>Go back and edit</Button>
      </div>
    </div>
  );
}
