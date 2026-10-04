// How a match is graded. Each matcher reports the signals it found (why two
// records look alike); this turns them into a strength, a score and the
// reasons shown to the user.
//
// Rule first, score second: a strong identifier (the same email, the same
// GSTIN) makes a strong duplicate whatever else differs. The score only
// orders matches and is never shown as the reason.
//
//   strong    refuse the save unless the user chooses the existing record
//             or, with permission, creates anyway with a reason
//   possible  warn, and let the user continue

// signal -> { label, weight, strong }
const PERSON_SIGNALS = Object.freeze({
  email: { label: "Same email", weight: 100, strong: true },
  mobile: { label: "Same mobile number", weight: 90, strong: true },
  phone_name: { label: "Same phone number and name", weight: 90, strong: true },
  phone: { label: "Same phone number", weight: 60, strong: false },
  name_company: { label: "Same name at the same company", weight: 60, strong: false },
  name_email_domain: { label: "Similar name with the same email domain", weight: 50, strong: false },
  similar_name: { label: "Similar name", weight: 30, strong: false },
  name: { label: "Same name", weight: 30, strong: false },
});

const COMPANY_SIGNALS = Object.freeze({
  gstin: { label: "Same GSTIN", weight: 100, strong: true },
  website_name: { label: "Same website and a similar name", weight: 95, strong: true },
  name: { label: "Same company name", weight: 80, strong: true },
  website: { label: "Same website domain", weight: 60, strong: false },
  similar_name: { label: "Similar company name", weight: 40, strong: false },
  name_phone: { label: "Similar name and the same phone", weight: 50, strong: false },
  name_email_domain: { label: "Similar name and the same email domain", weight: 50, strong: false },
  name_city: { label: "Similar name in the same city", weight: 50, strong: false },
});

// weaker signal -> the stronger ones that already say it
const IMPLIED_BY = Object.freeze({
  similar_name: ["name", "website_name", "name_company", "name_email_domain", "name_phone", "name_city", "phone_name"],
  name: ["name_company", "phone_name"],
  website: ["website_name"],
});

export const DUPLICATE_SIGNALS =Object.freeze({ lead: PERSON_SIGNALS, contact: PERSON_SIGNALS, account: COMPANY_SIGNALS });

// signals: the matcher's codes. Returns the fields every match carries:
//   strength       "exact" (strong) | "possible" — the name older callers test
//   matchStrength  "strong" | "possible"
//   score          0–100
//   reasons        [{ signal, label, strong }], strongest first
export function gradeMatch(kind, signals = []) {
  const catalogue = DUPLICATE_SIGNALS[kind] ?? PERSON_SIGNALS;
  // "Same company name" already says "similar name": show the stronger reason only.
  const implied = (signal) => (IMPLIED_BY[signal] ?? []).some((stronger) => signals.includes(stronger));
  const reasons = [...new Set(signals)]
    .filter((signal) => !implied(signal))
    .map((signal) => ({ signal, label: catalogue[signal]?.label ?? signal, strong: Boolean(catalogue[signal]?.strong), weight: catalogue[signal]?.weight ?? 10 }))
    .sort((left, right) => right.weight - left.weight);
  const strong = reasons.some((reason) => reason.strong);
  const score = Math.min(100, reasons.reduce((best, reason, index) => (index === 0 ? reason.weight : best + Math.round(reason.weight / 4)), 0));
  return {
    strength: strong ? "exact" : "possible",
    matchStrength: strong ? "strong" : "possible",
    score,
    reasons: reasons.map(({ signal, label, strong: isStrong }) => ({ signal, label, strong: isStrong })),
  };
}

// Strong matches first, then by score.
export function sortMatches(matches) {
  return [...matches].sort((left, right) => (left.strength === right.strength ? right.score - left.score : left.strength === "exact" ? -1 : 1));
}
