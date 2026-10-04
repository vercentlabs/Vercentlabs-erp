"use client";

// Moving an opportunity to another sales stage, the same way from every
// screen: the stage bar, the Next stage button, a pipeline card. All of them
// call the one opportunity operation. When the move deserves a second look
// (no quotation yet, nothing scheduled) the server says so first and the user
// confirms; a missing requirement is simply refused with its reason.
import { useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertDialog } from "@vercentlabs/design-system";

import { changeOpportunityStage, errorMessage, stageWarningOf, type Opportunity } from "@/features/crm/opportunities/api/opportunities-api";

type Move = { opportunity: Pick<Opportunity, "id" | "updatedAt" | "name">; stageId: string; confirmed?: boolean };

export function useStageChange({ onDone, onError }: { onDone: () => void; onError: (message: string | null) => void }): {
  move: (opportunity: Move["opportunity"], stageId: string) => void; isPending: boolean; dialog: ReactNode;
} {
  const [pending, setPending] = useState<{ move: Move; warnings: string[]; stageName: string } | null>(null);
  const mutation = useMutation({
    mutationFn: (move: Move) => changeOpportunityStage(move.opportunity.id, { stageId: move.stageId, expectedUpdatedAt: move.opportunity.updatedAt, warn: !move.confirmed }),
    onSuccess: () => { setPending(null); onError(null); onDone(); },
    onError: (failure, move) => {
      const warning = stageWarningOf(failure);
      if (warning && !move.confirmed) setPending({ move, ...warning });
      else { setPending(null); onError(errorMessage(failure)); }
    },
  });
  return {
    move: (opportunity, stageId) => mutation.mutate({ opportunity, stageId }),
    isPending: mutation.isPending,
    dialog: (
      <StageWarningDialog warning={pending} isConfirming={mutation.isPending} onCancel={() => setPending(null)}
        onConfirm={() => pending && mutation.mutate({ ...pending.move, confirmed: true })} />
    ),
  };
}

export function StageWarningDialog({ warning, isConfirming, onCancel, onConfirm }: {
  warning: { warnings: string[]; stageName: string } | null; isConfirming: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <AlertDialog
      isOpen={Boolean(warning)}
      onOpenChange={(open) => !open && onCancel()}
      title={`Moving to ${warning?.stageName ?? "the next stage"}`}
      description={`${warning?.warnings.join(" ") ?? ""} Continue?`}
      confirmLabel="Continue"
      isConfirming={isConfirming}
      onConfirm={onConfirm}
    />
  );
}
