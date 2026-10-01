"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Button,
  Dialog,
  Select,
  TextArea,
  TextField,
} from "@vercentlabs/design-system";
import { formatMoney } from "@/shared/format/human";
import {
  reviewGovernedForecast,
  type ForecastOwnerRow,
} from "../api/forecast-api";

export function ReviewDialog({
  owner,
  currency,
  onClose,
  onDone,
}: {
  owner: ForecastOwnerRow | null;
  currency: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [decision, setDecision] = useState<"approve" | "reject" | "adjust">(
    "approve",
  );
  const [adjustment, setAdjustment] = useState("0");
  const [reason, setReason] = useState("");
  const submission = owner?.submission;
  const mutation = useMutation({
    mutationFn: () =>
      reviewGovernedForecast(submission!.id, {
        decision,
        managerAdjustment:
          decision === "adjust" ? Number(adjustment) : undefined,
        reason,
        expectedVersion: submission!.version,
      }),
    onSuccess: () => {
      setReason("");
      onDone();
    },
  });
  return (
    <Dialog
      isOpen={owner !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={owner ? `Review ${owner.ownerName}'s forecast` : "Review forecast"}
      description={
        submission
          ? `Submitted commit ${formatMoney(currency, submission.commitAmount)}, best case ${formatMoney(currency, submission.bestCaseAmount)}. An adjustment is added to the seller's commit; their own number never changes.`
          : undefined
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <Select
          label="Decision"
          options={[
            { value: "approve", label: "Approve" },
            { value: "adjust", label: "Adjust commit" },
            { value: "reject", label: "Send back" },
          ]}
          selectedKey={decision}
          onSelectionChange={(key) =>
            setDecision((key as "approve" | "reject" | "adjust") ?? "approve")
          }
        />
        {decision === "adjust" && (
          <TextField
            label="Adjustment (can be negative)"
            type="number"
            inputMode="decimal"
            value={adjustment}
            onChange={setAdjustment}
            isRequired
          />
        )}
        <TextArea
          label="Reason"
          value={reason}
          onChange={setReason}
          isRequired={decision !== "approve"}
          description="Kept in the forecast history."
        />
        {mutation.isError && (
          <p role="alert" className="text-sm text-danger">
            {(mutation.error as Error).message}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            isLoading={mutation.isPending}
            isDisabled={decision !== "approve" && reason.trim().length < 3}
          >
            Save review
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
