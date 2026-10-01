import type { SelectOption } from "@vercentlabs/design-system";

// Mirrors meeting-operations.js's OUTCOMES set exactly. "no_show" matters:
// touchParentOnCompletion only refreshes Lead/Opportunity last-contact for
// "held", so silently defaulting every quick-complete to "held" would
// corrupt that tracking for meetings nobody attended.
export const MEETING_OUTCOME_OPTIONS: SelectOption[] = [
  { value: "held", label: "Held" },
  { value: "no_show", label: "No-show" },
];
