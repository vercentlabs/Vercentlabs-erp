// What a stage asks of a deal (CRM plan 5.1: configurable per stage). A few conditions a deal can be checked for, and for each stage
// which of them it requires (the move is refused without it) or only warns about (the mover is asked "continue?"). Also the actions
// worth suggesting in each stage. No stage-gate engine.
//
// A stage whose rules were never set (entry_rules NULL) keeps the standard ones, keyed by its stable code, never its name, so an
// organization can rename Proposal to "Solution Presented" and the rules still hold. An empty list means no rules.

// The conditions, as checked on the opportunity row (snake_case columns, as loaded with its counts).
export const STAGE_RULES = Object.freeze({
  contact: { label: "Primary contact", missing: (row) => !row.contact_id, require: "Choose a primary contact before moving this deal to", warn: "The deal has no primary contact yet." },
  closeDate: { label: "Expected close date", missing: (row) => !row.expected_close_date, require: "Set the expected close date before moving this deal to", warn: "The deal has no expected close date." },
  amount: { label: "Estimated value", missing: (row) => !(Number(row.amount) > 0), require: "Enter the deal's estimated value before moving it to", warn: "The deal has no estimated value yet." },
  products: { label: "Products on the deal", missing: (row) => Number(row.product_count ?? 0) === 0, require: "Add the products being sold before moving this deal to", warn: "The deal has no products yet." },
  quotation: { label: "A quotation", missing: (row) => Number(row.quotation_count ?? 0) === 0, require: "Create a quotation before moving this deal to", warn: "No quotation exists for this deal yet." },
  nextActivity: { label: "A next activity", missing: (row) => !row.next_activity_subject, require: "Schedule the next activity before moving this deal to", warn: "No next activity is scheduled." },
});
export const STAGE_RULE_LEVELS = Object.freeze(["require", "warn"]);

// The standard stages' rules, used until an organization sets a stage's own.
const STANDARD_RULES = Object.freeze({
  PROPOSAL: [{ rule: "contact", level: "require" }, { rule: "amount", level: "warn" }, { rule: "quotation", level: "warn" }],
  CLOSING: [{ rule: "closeDate", level: "require" }, { rule: "nextActivity", level: "warn" }],
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

// The stage's rules: [{ rule, level }], its own when set, else the standard ones.
export function stageRules(stage) {
  const own = stage?.entry_rules ?? stage?.entryRules;
  const list = Array.isArray(own) ? own : STANDARD_RULES[codeOf(stage)] ?? [];
  return list.filter((entry) => STAGE_RULES[entry?.rule] && STAGE_RULE_LEVELS.includes(entry?.level)).map(({ rule, level }) => ({ rule, level }));
}

// Checks and cleans a stage's rules as set on the settings screen (one level per condition). null restores the standard ones.
export function cleanStageRules(value) {
  if (value === null) return null;
  if (!Array.isArray(value)) return [];
  const seen = new Map();
  for (const entry of value)
    if (STAGE_RULES[entry?.rule] && STAGE_RULE_LEVELS.includes(entry?.level)) seen.set(entry.rule, entry.level);
  return [...seen].map(([rule, level]) => ({ rule, level }));
}

// The requirements the deal does not meet for this stage, as messages. Empty when it may enter.
export function stageEntryBlockers(row, stage) {
  return stageRules(stage).filter((entry) => entry.level === "require" && STAGE_RULES[entry.rule].missing(row))
    .map((entry) => `${STAGE_RULES[entry.rule].require} ${stage.name}.`);
}

// Things worth a second look before entering this stage, as messages.
export function stageEntryWarnings(row, stage) {
  return stageRules(stage).filter((entry) => entry.level === "warn" && STAGE_RULES[entry.rule].missing(row)).map((entry) => STAGE_RULES[entry.rule].warn);
}

// What the stage requires, for the stage track's checklist: [{ key, label }].
export function stageRequirements(stage) {
  return stageRules(stage).filter((entry) => entry.level === "require").map((entry) => ({ key: entry.rule, label: STAGE_RULES[entry.rule].label }));
}

export function suggestedStageActions(stage) {
  return SUGGESTED_ACTIONS[codeOf(stage)] ?? [];
}
