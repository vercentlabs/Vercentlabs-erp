import type { SelectOption } from "@vercentlabs/design-system";

// Mirrors call-operations.js's OUTCOMES set exactly (services/api/src/
// modules/crm/seller-activity-and-follow-up-workspace/call-operations.js).
// Shared by the create form's log mode and the complete-call dialog so a
// second picker can't silently drift from the governed outcome list.
export const OUTCOME_OPTIONS: SelectOption[] = [
  { value: "connected", label: "Connected" },
  { value: "no_answer", label: "No answer" },
  { value: "busy", label: "Busy" },
  { value: "voicemail", label: "Voicemail" },
  { value: "callback_requested", label: "Callback requested" },
  { value: "wrong_number", label: "Wrong number" },
  { value: "failed", label: "Failed" },
];
