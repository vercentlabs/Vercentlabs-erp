"use client";

import {
  getStructuredFieldConfig,
  parseStructuredValue,
  stringifyStructuredValue,
  structuredValueSummary,
  type StructuredFieldConfig,
  type StructuredFieldKind,
} from "@vercentlabs/shared-types";
import { useRef, useState } from "react";

export type StructuredFieldDescriptor = {
  name: string;
  label: string;
  required?: boolean;
  helpText?: string;
  structuredKind?:
    | "list"
    | "key-value"
    | "actions"
    | "schedule"
    | "value";
  structuredOptionsKey?: string;
};

type Option = { id: string; name: string };
type Pair = { id: string; key: string; value: string };
type ActionDraft = { id: string; pairs: Pair[] };
type ValueType = "string" | "number" | "boolean" | "null";

type ScheduleDay = {
  enabled: boolean;
  start: string;
  end: string;
};

type Draft =
  | { kind: "list"; items: Array<{ id: string; value: string }> }
  | { kind: "key-value"; pairs: Pair[] }
  | { kind: "actions"; actions: ActionDraft[] }
  | { kind: "schedule"; days: Record<string, ScheduleDay> }
  | {
      kind: "value";
      valueType: ValueType;
      value: string;
    };

const dayNames = [
  ["monday", "Monday"],
  ["tuesday", "Tuesday"],
  ["wednesday", "Wednesday"],
  ["thursday", "Thursday"],
  ["friday", "Friday"],
  ["saturday", "Saturday"],
  ["sunday", "Sunday"],
] as const;

const actionTypes = [
  ["create_activity", "Create activity"],
  ["notification", "Send notification"],
  ["update_record", "Update record"],
  ["assign_owner", "Assign owner"],
  ["enroll_sequence", "Enroll in sequence"],
  ["create_recommendation", "Create recommendation"],
  ["queue_communication", "Queue communication"],
] as const;

const actionTemplates: Record<string, Array<[string, string]>> = {
  create_activity: [
    ["activityType", "task"],
    ["subject", ""],
    ["description", ""],
    ["assignedTo", ""],
    ["delayMinutes", "0"],
  ],
  notification: [
    ["userId", ""],
    ["title", "CRM automation"],
    ["message", ""],
    ["href", ""],
  ],
  update_record: [["fields.status", ""]],
  assign_owner: [["userId", ""]],
  enroll_sequence: [
    ["sequenceId", ""],
    ["delayMinutes", "0"],
  ],
  create_recommendation: [
    ["title", ""],
    ["rationale", ""],
    ["priority", "medium"],
    ["confidence", ""],
    ["dueAt", ""],
  ],
  queue_communication: [
    ["channel", "email"],
    ["subject", ""],
    ["body", ""],
    ["fromAddress", ""],
    ["toAddresses", ""],
  ],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function displayValue(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function flattenObject(
  value: Record<string, unknown>,
  prefix = "",
): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const [key, current] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(current)) {
      const nested = flattenObject(current, path);
      if (nested.length) entries.push(...nested);
      else entries.push([path, ""]);
    } else {
      entries.push([path, displayValue(current)]);
    }
  }
  return entries;
}

function coerceValue(key: string, value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (
    /(?:addresses|fields|ids|scopes|types|columns)$/i.test(key) &&
    trimmed.includes(",")
  ) {
    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function setPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
) {
  const parts = path
    .split(".")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!parts.length) return;
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const current = cursor[part];
    if (!isPlainObject(current)) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts.at(-1) as string] = value;
}

function pairsToObject(pairs: Pair[]) {
  const result: Record<string, unknown> = {};
  for (const pair of pairs) {
    const key = pair.key.trim();
    if (!key) continue;
    setPath(result, key, coerceValue(key, pair.value));
  }
  return result;
}

function emptyDays(): Record<string, ScheduleDay> {
  return Object.fromEntries(
    dayNames.map(([key]) => [
      key,
      { enabled: false, start: "09:00", end: "17:00" },
    ]),
  );
}

function scheduleFromValue(value: unknown) {
  const days = emptyDays();
  if (!isPlainObject(value)) return days;
  for (const [day] of dayNames) {
    const current = value[day];
    const slot = Array.isArray(current) ? current[0] : current;
    if (!isPlainObject(slot)) continue;
    days[day] = {
      enabled: true,
      start: String(slot.start || slot.from || "09:00"),
      end: String(slot.end || slot.to || "17:00"),
    };
  }
  return days;
}

function draftFromValue(
  kind: StructuredFieldKind,
  value: unknown,
  id: (prefix: string) => string,
): { draft: Draft; incompatible: boolean } {
  if (kind === "list") {
    if (value === "" || value === null || value === undefined) {
      return { draft: { kind, items: [] }, incompatible: false };
    }
    if (!Array.isArray(value)) {
      return { draft: { kind, items: [] }, incompatible: true };
    }
    return {
      draft: {
        kind,
        items: value.map((item) => ({
          id: id("item"),
          value: displayValue(item),
        })),
      },
      incompatible: false,
    };
  }

  if (kind === "actions") {
    if (value === "" || value === null || value === undefined) {
      return { draft: { kind, actions: [] }, incompatible: false };
    }
    if (!Array.isArray(value) || !value.every(isPlainObject)) {
      return { draft: { kind, actions: [] }, incompatible: true };
    }
    return {
      draft: {
        kind,
        actions: value.map((action) => ({
          id: id("action"),
          pairs: flattenObject(action).map(([key, item]) => ({
            id: id("pair"),
            key,
            value: item,
          })),
        })),
      },
      incompatible: false,
    };
  }

  if (kind === "schedule") {
    return {
      draft: { kind, days: scheduleFromValue(value) },
      incompatible:
        value !== "" &&
        value !== null &&
        value !== undefined &&
        !isPlainObject(value),
    };
  }

  if (kind === "value") {
    if (value === null) {
      return {
        draft: { kind, valueType: "null", value: "" },
        incompatible: false,
      };
    }
    if (typeof value === "boolean") {
      return {
        draft: { kind, valueType: "boolean", value: String(value) },
        incompatible: false,
      };
    }
    if (typeof value === "number") {
      return {
        draft: { kind, valueType: "number", value: String(value) },
        incompatible: false,
      };
    }
    if (
      typeof value === "string" ||
      value === undefined ||
      value === ""
    ) {
      return {
        draft: {
          kind,
          valueType: "string",
          value: String(value || ""),
        },
        incompatible: false,
      };
    }
    return {
      draft: { kind, valueType: "string", value: "" },
      incompatible: true,
    };
  }

  if (value === "" || value === null || value === undefined) {
    return { draft: { kind: "key-value", pairs: [] }, incompatible: false };
  }
  if (!isPlainObject(value)) {
    return { draft: { kind: "key-value", pairs: [] }, incompatible: true };
  }
  return {
    draft: {
      kind: "key-value",
      pairs: flattenObject(value).map(([key, item]) => ({
        id: id("pair"),
        key,
        value: item,
      })),
    },
    incompatible: false,
  };
}

function draftValue(draft: Draft): unknown {
  if (draft.kind === "list") {
    return draft.items
      .map((item) => item.value.trim())
      .filter(Boolean);
  }
  if (draft.kind === "key-value") return pairsToObject(draft.pairs);
  if (draft.kind === "actions") {
    return draft.actions
      .map((action) => pairsToObject(action.pairs))
      .filter((action) => Object.keys(action).length);
  }
  if (draft.kind === "schedule") {
    return Object.fromEntries(
      Object.entries(draft.days)
        .filter(([, value]) => value.enabled)
        .map(([day, value]) => [
          day,
          [{ start: value.start, end: value.end }],
        ]),
    );
  }
  if (draft.valueType === "null") return null;
  if (draft.valueType === "boolean") return draft.value === "true";
  if (draft.valueType === "number") {
    const numeric = Number(draft.value);
    return Number.isFinite(numeric) ? numeric : draft.value;
  }
  return draft.value;
}

function hasGuidedValue(draft: Draft) {
  const value = draftValue(draft);
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return value !== "";
}

function pairValueControl(
  pair: Pair,
  onChange: (value: string) => void,
  options: Record<string, Option[]>,
) {
  const normalized = pair.key.toLowerCase();
  const optionKey =
    normalized.includes("userid") || normalized === "assignedto"
      ? "users"
      : normalized.includes("sequenceid")
        ? "sequences"
        : null;
  const availableOptions = optionKey ? options[optionKey] || [] : [];
  if (availableOptions.length) {
    return (
      <select
        aria-label={`Value for ${pair.key || "setting"}`}
        value={pair.value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select</option>
        {availableOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    );
  }
  if (normalized === "type") {
    return (
      <select
        aria-label="Action type"
        value={pair.value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select action</option>
        {actionTypes.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      aria-label={`Value for ${pair.key || "setting"}`}
      value={pair.value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Value"
    />
  );
}

export default function StructuredFieldEditor({
  field,
  initialValue,
  options,
}: {
  field: StructuredFieldDescriptor;
  initialValue: unknown;
  options: Record<string, Option[]>;
}) {
  const configured = getStructuredFieldConfig(field.name, field.label);
  const config: StructuredFieldConfig = configured || {
    kind: field.structuredKind || "key-value",
    label: field.label,
    helpText:
      field.helpText ||
      "Add the information using guided fields.",
  };
  const parsed = parseStructuredValue(initialValue, config.kind);
  const counter = useRef(0);
  const nextId = (prefix: string) => {
    counter.current += 1;
    return `${prefix}-${counter.current}`;
  };
  const [initial] = useState(() => {
    let initialCounter = 0;
    return draftFromValue(
      config.kind,
      parsed,
      (prefix) => `${prefix}-initial-${++initialCounter}`,
    );
  });
  const [draft, setDraft] = useState<Draft>(initial.draft);
  const [advanced, setAdvanced] = useState(initial.incompatible);
  const [advancedText, setAdvancedText] = useState(() =>
    stringifyStructuredValue(parsed),
  );
  const [advancedError, setAdvancedError] = useState("");

  const guidedValue = draftValue(draft);
  const serialized = advanced
    ? advancedText.trim()
    : hasGuidedValue(draft)
      ? stringifyStructuredValue(guidedValue)
      : "";

  const switchToGuided = () => {
    const text = advancedText.trim();
    if (!text) {
      const next = draftFromValue(config.kind, "", nextId);
      setDraft(next.draft);
      setAdvanced(false);
      setAdvancedError("");
      return;
    }
    try {
      const nextValue = JSON.parse(text);
      const next = draftFromValue(config.kind, nextValue, nextId);
      if (next.incompatible) {
        setAdvancedError(
          "This advanced configuration cannot be represented safely by the guided editor.",
        );
        return;
      }
      setDraft(next.draft);
      setAdvanced(false);
      setAdvancedError("");
    } catch {
      setAdvancedError(
        "The advanced configuration is invalid. Correct it before returning to the guided editor.",
      );
    }
  };

  const switchToAdvanced = () => {
    setAdvancedText(
      hasGuidedValue(draft)
        ? stringifyStructuredValue(guidedValue)
        : "",
    );
    setAdvanced(true);
    setAdvancedError("");
  };

  const listOptions =
    field.structuredOptionsKey && options[field.structuredOptionsKey]
      ? options[field.structuredOptionsKey]
      : config.optionsKey && options[config.optionsKey]
        ? options[config.optionsKey]
        : [];

  return (
    <fieldset className="structured-field">
      <legend className="sr-only">
        {config.label}
        {field.required ? " required" : ""}
      </legend>
      <input
        type="hidden"
        name={field.name}
        value={serialized}
        data-structured-field={config.kind}
      />
      <div className="structured-field-heading">
        <div>
          <strong className="structured-field-label">
            {config.label}
            {field.required ? " *" : ""}
          </strong>
          <p>{field.helpText || config.helpText}</p>
        </div>
        <span className="structured-field-summary">
          {structuredValueSummary(
            advanced ? advancedText : guidedValue,
            config.label,
          )}
        </span>
      </div>

      {advanced ? (
        <div className="structured-advanced">
          <label>
            Technical configuration
            <textarea
              value={advancedText}
              onChange={(event) => {
                setAdvancedText(event.target.value);
                setAdvancedError("");
              }}
              rows={8}
              spellCheck={false}
            />
          </label>
          {advancedError ? (
            <p className="field-error" role="alert">
              {advancedError}
            </p>
          ) : null}
          <button
            className="secondary-button"
            type="button"
            onClick={switchToGuided}
          >
            Return to guided editor
          </button>
        </div>
      ) : null}

      {!advanced && draft.kind === "list" ? (
        <div className="structured-stack">
          {draft.items.map((item, index) => (
            <div className="structured-list-row" key={item.id}>
              <span aria-hidden="true">{index + 1}</span>
              {listOptions.length ? (
                <select
                  aria-label={`${config.label} item ${index + 1}`}
                  value={item.value}
                  onChange={(event) =>
                    setDraft((current) =>
                      current.kind === "list"
                        ? {
                            ...current,
                            items: current.items.map((entry) =>
                              entry.id === item.id
                                ? { ...entry, value: event.target.value }
                                : entry,
                            ),
                          }
                        : current,
                    )
                  }
                >
                  <option value="">Select</option>
                  {listOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label={`${config.label} item ${index + 1}`}
                  value={item.value}
                  onChange={(event) =>
                    setDraft((current) =>
                      current.kind === "list"
                        ? {
                            ...current,
                            items: current.items.map((entry) =>
                              entry.id === item.id
                                ? { ...entry, value: event.target.value }
                                : entry,
                            ),
                          }
                        : current,
                    )
                  }
                  placeholder="Add an item"
                />
              )}
              <button
                className="icon-button"
                type="button"
                aria-label={`Remove ${config.label} item ${index + 1}`}
                onClick={() =>
                  setDraft((current) =>
                    current.kind === "list"
                      ? {
                          ...current,
                          items: current.items.filter(
                            (entry) => entry.id !== item.id,
                          ),
                        }
                      : current,
                  )
                }
              >
                ×
              </button>
            </div>
          ))}
          <button
            className="secondary-button structured-add"
            type="button"
            onClick={() =>
              setDraft((current) =>
                current.kind === "list"
                  ? {
                      ...current,
                      items: [
                        ...current.items,
                        { id: nextId("item"), value: "" },
                      ],
                    }
                  : current,
              )
            }
          >
            Add item
          </button>
        </div>
      ) : null}

      {!advanced && draft.kind === "key-value" ? (
        <div className="structured-stack">
          {draft.pairs.map((pair, index) => (
            <div className="structured-pair-row" key={pair.id}>
              <input
                aria-label={`Label ${index + 1}`}
                value={pair.key}
                onChange={(event) =>
                  setDraft((current) =>
                    current.kind === "key-value"
                      ? {
                          ...current,
                          pairs: current.pairs.map((entry) =>
                            entry.id === pair.id
                              ? { ...entry, key: event.target.value }
                              : entry,
                          ),
                        }
                      : current,
                  )
                }
                placeholder="Field or label"
              />
              {pairValueControl(
                pair,
                (value) =>
                  setDraft((current) =>
                    current.kind === "key-value"
                      ? {
                          ...current,
                          pairs: current.pairs.map((entry) =>
                            entry.id === pair.id
                              ? { ...entry, value }
                              : entry,
                          ),
                        }
                      : current,
                  ),
                options,
              )}
              <button
                className="icon-button"
                type="button"
                aria-label={`Remove row ${index + 1}`}
                onClick={() =>
                  setDraft((current) =>
                    current.kind === "key-value"
                      ? {
                          ...current,
                          pairs: current.pairs.filter(
                            (entry) => entry.id !== pair.id,
                          ),
                        }
                      : current,
                  )
                }
              >
                ×
              </button>
            </div>
          ))}
          <button
            className="secondary-button structured-add"
            type="button"
            onClick={() =>
              setDraft((current) =>
                current.kind === "key-value"
                  ? {
                      ...current,
                      pairs: [
                        ...current.pairs,
                        { id: nextId("pair"), key: "", value: "" },
                      ],
                    }
                  : current,
              )
            }
          >
            Add labelled value
          </button>
        </div>
      ) : null}

      {!advanced && draft.kind === "actions" ? (
        <div className="structured-stack">
          {draft.actions.map((action, actionIndex) => {
            const typePair = action.pairs.find(
              (pair) => pair.key === "type",
            );
            return (
              <article className="structured-action-card" key={action.id}>
                <div className="structured-action-heading">
                  <strong>Action {actionIndex + 1}</strong>
                  <button
                    className="link-button danger"
                    type="button"
                    onClick={() =>
                      setDraft((current) =>
                        current.kind === "actions"
                          ? {
                              ...current,
                              actions: current.actions.filter(
                                (entry) => entry.id !== action.id,
                              ),
                            }
                          : current,
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
                <label>
                  Action type
                  <select
                    value={typePair?.value || ""}
                    onChange={(event) => {
                      const selected = event.target.value;
                      const template = actionTemplates[selected] || [];
                      setDraft((current) =>
                        current.kind === "actions"
                          ? {
                              ...current,
                              actions: current.actions.map((entry) =>
                                entry.id === action.id
                                  ? {
                                      ...entry,
                                      pairs: [
                                        {
                                          id:
                                            typePair?.id ||
                                            nextId("pair"),
                                          key: "type",
                                          value: selected,
                                        },
                                        ...template.map(([key, value]) => ({
                                          id: nextId("pair"),
                                          key,
                                          value,
                                        })),
                                      ],
                                    }
                                  : entry,
                              ),
                            }
                          : current,
                      );
                    }}
                  >
                    <option value="">Select action</option>
                    {actionTypes.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                {action.pairs
                  .filter((pair) => pair.key !== "type")
                  .map((pair, pairIndex) => (
                    <div className="structured-pair-row" key={pair.id}>
                      <input
                        aria-label={`Action setting ${pairIndex + 1}`}
                        value={pair.key}
                        onChange={(event) =>
                          setDraft((current) =>
                            current.kind === "actions"
                              ? {
                                  ...current,
                                  actions: current.actions.map((entry) =>
                                    entry.id === action.id
                                      ? {
                                          ...entry,
                                          pairs: entry.pairs.map((item) =>
                                            item.id === pair.id
                                              ? {
                                                  ...item,
                                                  key: event.target.value,
                                                }
                                              : item,
                                          ),
                                        }
                                      : entry,
                                  ),
                                }
                              : current,
                          )
                        }
                        placeholder="Setting"
                      />
                      {pairValueControl(
                        pair,
                        (value) =>
                          setDraft((current) =>
                            current.kind === "actions"
                              ? {
                                  ...current,
                                  actions: current.actions.map((entry) =>
                                    entry.id === action.id
                                      ? {
                                          ...entry,
                                          pairs: entry.pairs.map((item) =>
                                            item.id === pair.id
                                              ? { ...item, value }
                                              : item,
                                          ),
                                        }
                                      : entry,
                                  ),
                                }
                              : current,
                          ),
                        options,
                      )}
                      <button
                        className="icon-button"
                        type="button"
                        aria-label={`Remove action setting ${pairIndex + 1}`}
                        onClick={() =>
                          setDraft((current) =>
                            current.kind === "actions"
                              ? {
                                  ...current,
                                  actions: current.actions.map((entry) =>
                                    entry.id === action.id
                                      ? {
                                          ...entry,
                                          pairs: entry.pairs.filter(
                                            (item) => item.id !== pair.id,
                                          ),
                                        }
                                      : entry,
                                  ),
                                }
                              : current,
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                <button
                  className="secondary-button structured-add"
                  type="button"
                  onClick={() =>
                    setDraft((current) =>
                      current.kind === "actions"
                        ? {
                            ...current,
                            actions: current.actions.map((entry) =>
                              entry.id === action.id
                                ? {
                                    ...entry,
                                    pairs: [
                                      ...entry.pairs,
                                      {
                                        id: nextId("pair"),
                                        key: "",
                                        value: "",
                                      },
                                    ],
                                  }
                                : entry,
                            ),
                          }
                        : current,
                    )
                  }
                >
                  Add action setting
                </button>
              </article>
            );
          })}
          <button
            className="secondary-button structured-add"
            type="button"
            onClick={() =>
              setDraft((current) =>
                current.kind === "actions"
                  ? {
                      ...current,
                      actions: [
                        ...current.actions,
                        {
                          id: nextId("action"),
                          pairs: [
                            {
                              id: nextId("pair"),
                              key: "type",
                              value: "",
                            },
                          ],
                        },
                      ],
                    }
                  : current,
              )
            }
          >
            Add action
          </button>
        </div>
      ) : null}

      {!advanced && draft.kind === "schedule" ? (
        <div className="structured-schedule">
          {dayNames.map(([key, label]) => {
            const day = draft.days[key];
            return (
              <div className="structured-day-row" key={key}>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={day.enabled}
                    onChange={(event) =>
                      setDraft((current) =>
                        current.kind === "schedule"
                          ? {
                              ...current,
                              days: {
                                ...current.days,
                                [key]: {
                                  ...current.days[key],
                                  enabled: event.target.checked,
                                },
                              },
                            }
                          : current,
                      )
                    }
                  />
                  {label}
                </label>
                <label>
                  Start
                  <input
                    type="time"
                    value={day.start}
                    disabled={!day.enabled}
                    onChange={(event) =>
                      setDraft((current) =>
                        current.kind === "schedule"
                          ? {
                              ...current,
                              days: {
                                ...current.days,
                                [key]: {
                                  ...current.days[key],
                                  start: event.target.value,
                                },
                              },
                            }
                          : current,
                      )
                    }
                  />
                </label>
                <label>
                  End
                  <input
                    type="time"
                    value={day.end}
                    disabled={!day.enabled}
                    onChange={(event) =>
                      setDraft((current) =>
                        current.kind === "schedule"
                          ? {
                              ...current,
                              days: {
                                ...current.days,
                                [key]: {
                                  ...current.days[key],
                                  end: event.target.value,
                                },
                              },
                            }
                          : current,
                      )
                    }
                  />
                </label>
              </div>
            );
          })}
        </div>
      ) : null}

      {!advanced && draft.kind === "value" ? (
        <div className="structured-value-row">
          <label>
            Value type
            <select
              value={draft.valueType}
              onChange={(event) =>
                setDraft((current) =>
                  current.kind === "value"
                    ? {
                        ...current,
                        valueType: event.target.value as ValueType,
                        value:
                          event.target.value === "boolean"
                            ? "false"
                            : event.target.value === "null"
                              ? ""
                              : current.value,
                      }
                    : current,
                )
              }
            >
              <option value="string">Text</option>
              <option value="number">Number</option>
              <option value="boolean">Yes or no</option>
              <option value="null">No value</option>
            </select>
          </label>
          {draft.valueType === "boolean" ? (
            <label>
              Value
              <select
                value={draft.value}
                onChange={(event) =>
                  setDraft((current) =>
                    current.kind === "value"
                      ? { ...current, value: event.target.value }
                      : current,
                  )
                }
              >
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
            </label>
          ) : draft.valueType !== "null" ? (
            <label>
              Value
              <input
                type={draft.valueType === "number" ? "number" : "text"}
                value={draft.value}
                onChange={(event) =>
                  setDraft((current) =>
                    current.kind === "value"
                      ? { ...current, value: event.target.value }
                      : current,
                  )
                }
              />
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="structured-field-footer">
        <button
          className="link-button"
          type="button"
          onClick={advanced ? switchToGuided : switchToAdvanced}
        >
          {advanced ? "Use guided editor" : "Advanced configuration"}
        </button>
        <small>
          The ERP stores this information as structured data automatically.
        </small>
      </div>
    </fieldset>
  );
}
