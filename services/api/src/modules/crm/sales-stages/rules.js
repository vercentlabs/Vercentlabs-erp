// What a stage asks of a deal. Deliberately small: a few requirements that
// refuse a move, a few warnings that only ask "continue?", and the actions
// worth suggesting in each stage. No stage-gate engine.
//
// Everything here is keyed by the stage's stable code, never its name, so an
// organization can rename Proposal to "Solution Presented" and the rules
// still hold. A stage the organization added itself has no rules.

// Refuses the move. `row` is the opportunity row (snake_case columns).
const REQUIREMENTS = Object.freeze({
  PROPOSAL: [
    { missing: (row) => !row.contact_id, message: "Choose a primary contact before moving this opportunity to" },
    { missing: (row) => !(Number(row.amount) > 0), message: "Enter the estimated value before moving this opportunity to" },
  ],
  CLOSING: [
    { missing: (row) => !row.expected_close_date, message: "Set the expected close date before moving this opportunity to" },
  ],
});

// Does not refuse: the caller confirms and the move goes ahead.
const WARNINGS = Object.freeze({
  PROPOSAL: [{ applies: (row) => Number(row.quotation_count ?? 0) === 0, message: "No quotation exists for this opportunity yet." }],
  CLOSING: [{ applies: (row) => !row.next_activity_subject, message: "No next activity is scheduled." }],
});

// The actions worth offering while a deal is in the stage. The codes are the
// actions the opportunity page already has; this only says which to put forward.
const SUGGESTED_ACTIONS = Object.freeze({
  DISCOVERY: ["log_activity", "schedule_follow_up", "edit_details"],
  NEEDS_ANALYSIS: ["edit_details", "add_products", "log_activity"],
  PROPOSAL: ["create_quotation", "view_quotations", "schedule_follow_up"],
  NEGOTIATION: ["create_quotation", "schedule_follow_up", "log_activity"],
  CLOSING: ["mark_won", "mark_lost", "schedule_follow_up"],
});

const codeOf = (stage) => String(stage?.code ?? "").toUpperCase();

// The requirements the deal does not meet for this stage, as messages. Empty when it may enter.
export function stageEntryBlockers(row, stage) {
  return (REQUIREMENTS[codeOf(stage)] ?? []).filter((rule) => rule.missing(row)).map((rule) => `${rule.message} ${stage.name}.`);
}

// Things worth a second look before entering this stage, as messages.
export function stageEntryWarnings(row, stage) {
  return (WARNINGS[codeOf(stage)] ?? []).filter((rule) => rule.applies(row)).map((rule) => rule.message);
}

export function suggestedStageActions(stage) {
  return SUGGESTED_ACTIONS[codeOf(stage)] ?? [];
}
