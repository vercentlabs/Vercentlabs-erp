"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Dialog, Select, TextArea } from "@vercentlabs/design-system";

import { completeMeeting } from "../api/meetings-api";
import { MEETING_OUTCOME_OPTIONS } from "../constants";
import type { Meeting } from "../types";

// F014 gap-closure — the only place completeMeeting was ever invoked from the
// UI (MeetingListScreen's row action) hardcoded outcomeCode to "held" with no
// way to record a no-show, even though the backend distinguishes them (only
// "held" refreshes the parent record's last-contact tracking, and a booked
// meeting's linked booking row flips to completed vs no_show accordingly).
export function CompleteMeetingDialog({
  meeting,
  onOpenChange,
  onDone,
  onError,
}: {
  meeting: Meeting;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
  onError: (error: unknown) => void;
}) {
  const [outcomeCode, setOutcomeCode] = useState("held");
  const [outcome, setOutcome] = useState("");

  const mutation = useMutation({
    mutationFn: () => completeMeeting(meeting.id, outcomeCode, outcome || undefined, meeting.updatedAt),
    onSuccess: () => {
      onDone();
      onOpenChange(false);
    },
    onError,
  });

  return (
    <Dialog isOpen onOpenChange={onOpenChange} title={`Complete ${meeting.subject}`}>
      <div className="flex flex-col gap-4">
        <Select label="Outcome" options={MEETING_OUTCOME_OPTIONS} selectedKey={outcomeCode} onSelectionChange={(key) => setOutcomeCode(String(key ?? "held"))} />
        <TextArea label="Notes" placeholder="Optional" value={outcome} onChange={setOutcome} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending}>
            Complete meeting
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
