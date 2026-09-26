// What AI may exist in the product. There are no customer-facing AI tools in
// the product today, so AI_TOOLS is empty and the Settings page says so; the
// organisation policy is ready for the first registered tool. A tool may only
// ever be named in a policy (or used by a request) if it is registered here,
// and no tool may write ledgers, stock, payroll, tax, payments or access
// tables directly: a tool proposes, and the normal command/approval runs it.
export const AI_TOOLS = Object.freeze([]);

// One organisation-wide policy for now.
export const AI_POLICY_KEYS = Object.freeze(["organization"]);

export function getAiTool(key) {
  return AI_TOOLS.find((tool) => tool.key === key) ?? null;
}
