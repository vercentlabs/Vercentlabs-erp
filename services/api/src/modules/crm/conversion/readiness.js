// Whether a lead may be converted, as pure functions over the lead row (as
// LEAD_SELECT returns it, with its qualification answers) and the
// organization's qualification requirements.
//
// Blocked: converted, disqualified, archived or merged leads never convert.
// Qualification: the lead should be qualified, with a business need and a
// product interest, plus every criterion the organization requires. A
// manager may convert with criteria missing, giving a reason.
import { evaluateLeadQualification } from "../leads/qualification-criteria.js";

const text = (value) => String(value ?? "").trim();

export function blockedReason(lead) {
  if (lead.status === "converted") return { code: "CRM_LEAD_ALREADY_CONVERTED", message: "This lead has already been converted." };
  if (lead.merged_into_lead_id) return { code: "CRM_LEAD_MERGED", message: "This lead was merged into another lead. Convert that lead instead." };
  if (lead.archived_at) return { code: "CRM_LEAD_ARCHIVED", message: "Restore this lead before converting it." };
  if (lead.status === "disqualified")
    return {
      code: "CRM_LEAD_DISQUALIFIED",
      message: lead.disqualification_reason === "duplicate"
        ? "This lead was disqualified as a duplicate. Work the original lead instead."
        : "This lead is disqualified. Reopen it before converting it.",
    };
  return null;
}

// Every check shown in the conversion dialog. `overridable` checks can be
// waived by a manager with a reason; the others are resolved in the dialog
// itself (choosing or entering an account and a contact).
export function conversionChecks(lead, requirements) {
  const { checklist } = evaluateLeadQualification(lead, requirements);
  const item = (key) => checklist.find((entry) => entry.key === key);
  const hasPerson = Boolean(text(lead.full_name) && (text(lead.email) || text(lead.mobile) || text(lead.phone)));
  const checks = [
    { key: "qualified", label: "Lead qualified", met: lead.status === "qualified", overridable: true, value: lead.status === "qualified" ? "Qualified" : "Not qualified yet" },
    { key: "need", label: "Business need identified", met: item("need").done, overridable: true, value: item("need").value },
    { key: "product", label: "Product or service interest", met: item("product").done, overridable: true, value: item("product").value },
    ...["budget", "authority", "timeline"].filter((key) => requirements[key])
      .map((key) => ({ key, label: item(key).label, met: item(key).done, overridable: true, value: item(key).value })),
    { key: "company", label: "Company or account", met: Boolean(text(lead.company_name)), overridable: false,
      value: text(lead.company_name) || "Not on the lead: choose or enter an account" },
    { key: "contact", label: "Contact name and a way to reach them", met: hasPerson, overridable: false,
      value: hasPerson ? [lead.full_name, lead.email || lead.mobile || lead.phone].join(" · ") : "Choose an existing contact or enter the contact's details" },
  ];
  return checks;
}

export function missingQualification(checks) {
  return checks.filter((check) => check.overridable && !check.met).map(({ key, label }) => ({ key, label }));
}

// Short words for the lead summary and the opportunity's commercial notes.
export function qualificationSummary(lead, requirements) {
  const { checklist, score, suggestedRating } = evaluateLeadQualification(lead, requirements);
  return { score, suggestedRating, checklist: checklist.map(({ key, label, done, value }) => ({ key, label, done, value })) };
}
