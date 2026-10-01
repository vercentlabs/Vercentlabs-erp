// Matches a record against a flat criteria object, e.g. the `conditions` of a
// CRM automation rule. Each criterion key must equal the record's value, or be
// one of the listed values when the criterion is an array. Strings compare
// trimmed and case-insensitively; a missing value compares as "".
//
// Other CRM matchers deliberately differ and are not interchangeable with this
// one: lead-intelligence.js also falls back to snake_case keys, lead
// assignment compares case-sensitive strings, and lead scoring uses operator
// predicates.

export function comparable(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}

export function criteriaMatches(input, criteria) {
  if (!criteria || typeof criteria !== "object") return true;
  return Object.entries(criteria).every(([key, expected]) =>
    Array.isArray(expected)
      ? expected.map(comparable).includes(comparable(input[key]))
      : comparable(input[key]) === comparable(expected),
  );
}
