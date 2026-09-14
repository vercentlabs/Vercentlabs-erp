import type { ReactNode } from "react";

import { ActivityTimeline, type ActivityTimelineItem, AuditTimeline, type AuditTimelineEntry } from "../enterprise/ActivityTimeline";
import { SectionHeader } from "../enterprise/PageHeader";

// Canonical Audit/Activity surface archetype: any Record 360 needs both a
// free-form activity feed (calls/meetings/tasks/notes/communications) and a
// field-level audit trail (who changed what, when) -- this composes the two
// timeline components from ../enterprise/ActivityTimeline.tsx into one
// reusable panel instead of every module's detail page hand-assembling the
// same section headers + spacing (first extracted from the CRM Lead 360
// golden reference, which built this shape ad hoc before this archetype
// existed).
export function RecordActivityPanel({
  activityItems,
  auditEntries,
  activityTitle = "Activity",
  auditTitle = "History",
  activityActions,
  activityEmptyLabel,
  auditEmptyLabel,
}: {
  activityItems: ActivityTimelineItem[];
  auditEntries: AuditTimelineEntry[];
  activityTitle?: ReactNode;
  auditTitle?: ReactNode;
  activityActions?: ReactNode;
  activityEmptyLabel?: ReactNode;
  auditEmptyLabel?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <SectionHeader title={activityTitle} actions={activityActions} />
        <div className="mt-3">
          <ActivityTimeline items={activityItems} emptyLabel={activityEmptyLabel} />
        </div>
      </section>
      <section>
        <SectionHeader title={auditTitle} />
        <div className="mt-3">
          <AuditTimeline entries={auditEntries} emptyLabel={auditEmptyLabel} />
        </div>
      </section>
    </div>
  );
}
