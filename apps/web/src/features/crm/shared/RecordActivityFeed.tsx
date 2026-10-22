"use client";

// A record's Activity tab: one feed with chips — All · Calls & meetings · Tasks · Follow-ups · Notes · Files · Changes — and the add buttons at
// its top (Log activity, New task, Schedule follow-up, Add note, Upload). All is the merged timeline; each other chip shows the record's own
// panel for that kind (the same panels the record always had), so this is one place to look, not a new feature. Log activity and Schedule
// follow-up open their dialogs; New task, Add note and Upload open the chip whose panel adds them.
import { useState, type ReactNode } from "react";
import { Button } from "@vercentlabs/design-system";

import { RecordTimelinePanel } from "./RecordTimelinePanel";
import { FilterChips } from "./ui/FilterChips";

export type ActivityChip = "all" | "calls" | "tasks" | "followUps" | "notes" | "files" | "changes";
const LABELS: Record<ActivityChip, string> = { all: "All", calls: "Calls & meetings", tasks: "Tasks", followUps: "Follow-ups", notes: "Notes", files: "Files", changes: "Changes" };

export function RecordActivityFeed({ entityType, entityId, sections, initial = "all", onLogActivity, onScheduleFollowUp, canAdd = true }: {
  entityType: string; entityId: string; initial?: ActivityChip;
  // The panel for each chip; a chip without a panel is not offered. "changes" may add the record's own stage history and audit trail.
  sections: Partial<Record<Exclude<ActivityChip, "all">, ReactNode>>;
  onLogActivity?: () => void; onScheduleFollowUp?: () => void; canAdd?: boolean;
}) {
  const offered = (["all", "calls", "tasks", "followUps", "notes", "files", "changes"] as ActivityChip[]).filter((chip) => chip === "all" || chip === "changes" || sections[chip]);
  const [chip, setChip] = useState<ActivityChip>(offered.includes(initial) ? initial : "all");
  const jump = (target: ActivityChip) => setChip(target);
  return (
    <div className="flex flex-col gap-4">
      {canAdd && (
        <div className="flex flex-wrap gap-2">
          {onLogActivity && <Button variant="secondary" size="compact" onPress={onLogActivity}>Log activity</Button>}
          {sections.tasks && <Button variant="secondary" size="compact" onPress={() => jump("tasks")}>New task</Button>}
          {onScheduleFollowUp && <Button variant="secondary" size="compact" onPress={onScheduleFollowUp}>New follow-up</Button>}
          {sections.notes && <Button variant="secondary" size="compact" onPress={() => jump("notes")}>Add note</Button>}
          {sections.files && <Button variant="secondary" size="compact" onPress={() => jump("files")}>Upload</Button>}
        </div>
      )}
      <FilterChips label="Show" chips={offered.map((id) => ({ id, label: LABELS[id] }))} selected={chip} onSelect={(id) => setChip(id as ActivityChip)} />
      {chip === "all" && <RecordTimelinePanel entityType={entityType} entityId={entityId} kinds={["activity", "note", "attachment", "stage", "history"]} />}
      {chip === "changes" && (
        <div className="flex flex-col gap-6">
          {sections.changes ?? <RecordTimelinePanel entityType={entityType} entityId={entityId} kinds={["stage", "history"]} />}
        </div>
      )}
      {chip !== "all" && chip !== "changes" && sections[chip]}
    </div>
  );
}
