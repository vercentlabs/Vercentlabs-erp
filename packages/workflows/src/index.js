export class WorkflowConflictError extends Error { constructor(message) { super(message); this.name = "WorkflowConflictError"; } }

export function assertApprovalDecision(input) {
  const decision = String(input?.decision || "").trim().toLowerCase();
  if (!["approved", "rejected", "cancelled"].includes(decision)) throw new TypeError("Decision must be approved, rejected or cancelled.");
  const note = input?.note == null ? null : String(input.note).trim().slice(0, 2_000) || null;
  if (decision === "rejected" && !note) throw new TypeError("A rejection note is required.");
  const expectedVersion = Number(input?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new TypeError("A positive approval version is required.");
  return Object.freeze({ decision, note, expectedVersion });
}

export function assertSeparationOfDuties({ requestedBy, actorUserId, allowSelfApproval = false }) {
  if (!allowSelfApproval && requestedBy && requestedBy === actorUserId) throw new WorkflowConflictError("The requester cannot approve their own request.");
}

export function createCommandRegistry(definitions) {
  const commands = new Map();
  for (const definition of definitions) {
    if (!/^[a-z][a-z0-9_.-]{2,120}$/.test(definition?.key || "") || typeof definition.execute !== "function" || typeof definition.validate !== "function") throw new TypeError("Invalid workflow command definition.");
    if (commands.has(definition.key)) throw new TypeError(`Duplicate workflow command: ${definition.key}`);
    commands.set(definition.key, Object.freeze({ ...definition }));
  }
  return Object.freeze({
    keys: () => Object.freeze([...commands.keys()]),
    get: (key) => commands.get(key) || null,
    validate(key, payload) { const command = commands.get(key); if (!command) throw new RangeError("Unsupported workflow command."); return command.validate(payload); },
    execute(key, context, payload) { const command = commands.get(key); if (!command) throw new RangeError("Unsupported workflow command."); return command.execute(context, command.validate(payload)); },
  });
}

export function transition(current, next, transitions) {
  const allowed = transitions[current] || [];
  if (!allowed.includes(next)) throw new WorkflowConflictError(`Transition from ${current} to ${next} is not allowed.`);
  return next;
}
