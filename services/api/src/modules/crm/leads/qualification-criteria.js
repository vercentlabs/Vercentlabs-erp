// What "qualified" means, as pure functions over a lead row (the lead with
// its qualification answers, as LEAD_SELECT returns it). No database access:
// the list, the lead page, the Qualify action and the reports all derive the
// same status, checklist and score from here.
import { LEAD_AUTHORITY_STATUSES, LEAD_BUDGET_STATUSES, LEAD_NEED_STATUSES, LEAD_PURCHASE_TIMEFRAMES } from "./constants.js";

// The four criteria an organization can require before a lead is qualified.
export const QUALIFICATION_CRITERIA = Object.freeze([
  { key: "need", label: "Business Need", checklist: "Requirement understood" },
  { key: "budget", label: "Budget", checklist: "Budget confirmed or likely" },
  { key: "authority", label: "Decision Authority", checklist: "Decision maker or influencer identified" },
  { key: "timeline", label: "Purchase Timeframe", checklist: "Purchase timeframe captured" },
]);

export const DEFAULT_QUALIFICATION_REQUIREMENTS = Object.freeze({ need: true, budget: false, authority: true, timeline: false });

const labelOf = (list, code) => list.find((entry) => entry.code === code)?.label ?? code ?? null;
const text = (value) => String(value ?? "").trim();

// Not qualified yet → in qualification → qualified | disqualified. A
// converted lead was qualified; it stays "qualified" here.
export function leadQualificationStatus(row) {
  if (row.status === "disqualified") return "disqualified";
  if (row.status === "qualified" || row.status === "converted") return "qualified";
  return row.q_started_at ? "in_progress" : "not_started";
}

// Each criterion: met (counts towards qualifying), and how far it is, in
// points out of 25, for the score.
function criteria(row) {
  const need = row.q_need_status ?? "unknown";
  const budget = row.q_budget_status ?? "unknown";
  const authority = row.q_authority_status ?? "unknown";
  const timeframe = row.purchase_timeframe;
  return {
    need: { met: need === "yes", points: need === "yes" ? 25 : 0, value: labelOf(LEAD_NEED_STATUSES, need) },
    budget: { met: budget === "confirmed" || budget === "likely", points: budget === "confirmed" ? 25 : budget === "likely" ? 15 : 0, value: labelOf(LEAD_BUDGET_STATUSES, budget) },
    authority: {
      met: authority === "decision_maker" || authority === "influencer",
      points: authority === "decision_maker" ? 25 : authority === "influencer" ? 15 : 0,
      value: labelOf(LEAD_AUTHORITY_STATUSES, authority),
    },
    timeline: { met: Boolean(timeframe) && timeframe !== "unknown", points: timeframe && timeframe !== "unknown" ? 25 : 0, value: labelOf(LEAD_PURCHASE_TIMEFRAMES, timeframe) ?? "Unknown" },
  };
}

// 0–100. An indicator for the salesperson, never the thing that qualifies a lead.
export function leadQualificationScore(row) {
  return Object.values(criteria(row)).reduce((sum, criterion) => sum + criterion.points, 0);
}

export function suggestedLeadRating(score) {
  return score >= 70 ? "hot" : score >= 40 ? "warm" : "cold";
}

// The checklist shown on the lead, and the required criteria still missing.
export function evaluateLeadQualification(row, requirements = DEFAULT_QUALIFICATION_REQUIREMENTS) {
  const state = criteria(row);
  const checklist = [
    { key: "need", label: QUALIFICATION_CRITERIA[0].checklist, done: state.need.met, required: requirements.need, value: state.need.value },
    { key: "product", label: "Relevant product or service identified", done: Boolean(text(row.product_interest)), required: false, value: text(row.product_interest) || null },
    ...QUALIFICATION_CRITERIA.slice(1).map((criterion) => ({
      key: criterion.key, label: criterion.checklist, done: state[criterion.key].met, required: requirements[criterion.key], value: state[criterion.key].value,
    })),
  ];
  const missing = QUALIFICATION_CRITERIA.filter((criterion) => requirements[criterion.key] && !state[criterion.key].met).map(({ key, label }) => ({ key, label }));
  const score = leadQualificationScore(row);
  return { checklist, missing, score, suggestedRating: suggestedLeadRating(score) };
}
