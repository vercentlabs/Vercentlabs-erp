import { Ionicons } from "@expo/vector-icons";
import {
  getStructuredFieldConfig,
  parseStructuredValue,
  stringifyStructuredValue,
  structuredValueSummary,
  type StructuredFieldConfig,
  type StructuredFieldKind,
} from "@vercentlabs/shared-types";
import type { MobileFieldDefinition } from "@vercentlabs/shared-sdk";
import { useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "@/shared/components/button";
import { useTheme } from "@/shared/theme/theme";

type Option = { id: string; name: string };
type Pair = { id: string; key: string; value: string };
type ActionDraft = { id: string; pairs: Pair[] };
type ValueType = "string" | "number" | "boolean" | "null";
type ScheduleDay = { enabled: boolean; start: string; end: string };

type Draft =
  | { kind: "list"; items: { id: string; value: string }[] }
  | { kind: "key-value"; pairs: Pair[] }
  | { kind: "actions"; actions: ActionDraft[] }
  | { kind: "schedule"; days: Record<string, ScheduleDay> }
  | { kind: "value"; valueType: ValueType; value: string };

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function displayValue(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function flattenObject(value: Record<string, unknown>, prefix = ""): [string, string][] {
  const result: [string, string][] = [];
  for (const [key, current] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(current)) result.push(...flattenObject(current, path));
    else result.push([path, displayValue(current)]);
  }
  return result;
}

function coerceValue(key: string, value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/(?:addresses|fields|ids|scopes|types|columns)$/i.test(key) && trimmed.includes(",")) {
    return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return trimmed;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".").map((item) => item.trim()).filter(Boolean);
  if (!parts.length) return;
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(cursor[part])) cursor[part] = {};
    cursor = cursor[part] as Record<string, unknown>;
  }
  const lastPart = parts.at(-1);
  if (!lastPart) return;
  cursor[lastPart] = value;
}

function pairsToObject(pairs: Pair[]) {
  const result: Record<string, unknown> = {};
  for (const pair of pairs) {
    if (pair.key.trim()) setPath(result, pair.key, coerceValue(pair.key, pair.value));
  }
  return result;
}

function emptyDays(): Record<string, ScheduleDay> {
  return Object.fromEntries(
    dayNames.map(([key]) => [key, { enabled: false, start: "09:00", end: "17:00" }]),
  );
}

function scheduleDay(
  days: Record<string, ScheduleDay>,
  key: string,
): ScheduleDay {
  return days[key] ?? { enabled: false, start: "09:00", end: "17:00" };
}

function updateScheduleDay(
  current: Draft,
  key: string,
  patch: Partial<ScheduleDay>,
): Draft {
  if (current.kind !== "schedule") return current;
  const existing = scheduleDay(current.days, key);
  return {
    ...current,
    days: {
      ...current.days,
      [key]: { ...existing, ...patch },
    },
  };
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
  preferredKind: StructuredFieldKind,
  value: unknown,
  id: (prefix: string) => string,
): Draft {
  if (preferredKind === "actions" && Array.isArray(value) && value.every(isPlainObject)) {
    return {
      kind: "actions",
      actions: value.map((action) => ({
        id: id("action"),
        pairs: flattenObject(action).map(([key, item]) => ({
          id: id("pair"),
          key,
          value: item,
        })),
      })),
    };
  }
  if (preferredKind === "schedule" && isPlainObject(value)) {
    return { kind: "schedule", days: scheduleFromValue(value) };
  }
  if (preferredKind === "list" && Array.isArray(value)) {
    return {
      kind: "list",
      items: value.map((item) => ({ id: id("item"), value: displayValue(item) })),
    };
  }
  if (preferredKind === "key-value" && isPlainObject(value)) {
    return {
      kind: "key-value",
      pairs: flattenObject(value).map(([key, item]) => ({
        id: id("pair"),
        key,
        value: item,
      })),
    };
  }
  if (preferredKind === "value" && !isPlainObject(value) && !Array.isArray(value)) {
    if (value === null) return { kind: "value", valueType: "null", value: "" };
    if (typeof value === "number") return { kind: "value", valueType: "number", value: String(value) };
    if (typeof value === "boolean") return { kind: "value", valueType: "boolean", value: String(value) };
    return { kind: "value", valueType: "string", value: String(value || "") };
  }

  if (Array.isArray(value)) {
    if (value.every(isPlainObject)) {
      return {
        kind: "actions",
        actions: value.map((entry) => ({
          id: id("action"),
          pairs: flattenObject(entry).map(([key, item]) => ({
            id: id("pair"),
            key,
            value: item,
          })),
        })),
      };
    }
    return {
      kind: "list",
      items: value.map((item) => ({ id: id("item"), value: displayValue(item) })),
    };
  }
  if (isPlainObject(value)) {
    return {
      kind: "key-value",
      pairs: flattenObject(value).map(([key, item]) => ({
        id: id("pair"),
        key,
        value: item,
      })),
    };
  }
  return { kind: "value", valueType: "string", value: String(value || "") };
}

function draftValue(draft: Draft): unknown {
  if (draft.kind === "list") return draft.items.map((item) => item.value.trim()).filter(Boolean);
  if (draft.kind === "key-value") return pairsToObject(draft.pairs);
  if (draft.kind === "actions") {
    return draft.actions.map((action) => pairsToObject(action.pairs)).filter((item) => Object.keys(item).length);
  }
  if (draft.kind === "schedule") {
    return Object.fromEntries(
      Object.entries(draft.days)
        .filter(([, day]) => day.enabled)
        .map(([key, day]) => [key, [{ start: day.start, end: day.end }]]),
    );
  }
  if (draft.valueType === "null") return null;
  if (draft.valueType === "boolean") return draft.value === "true";
  if (draft.valueType === "number") {
    const number = Number(draft.value);
    return Number.isFinite(number) ? number : draft.value;
  }
  return draft.value;
}

function serializedDraft(draft: Draft) {
  const value = draftValue(draft);
  if (Array.isArray(value) && !value.length) return "";
  if (isPlainObject(value) && !Object.keys(value).length) return "";
  if (value === "") return "";
  return stringifyStructuredValue(value);
}

export function StructuredFieldEditor({
  field,
  value,
  onChange,
  options,
}: {
  field: MobileFieldDefinition;
  value: string | boolean | undefined;
  onChange(value: string): void;
  options: Record<string, Option[]>;
}) {
  const { colors, radii, spacing, type } = useTheme();
  const counter = useRef(0);
  const nextId = (prefix: string) => `${prefix}-${++counter.current}`;
  const configured = getStructuredFieldConfig(field.name, field.label);
  const config: StructuredFieldConfig = configured || {
    kind: field.structuredKind || "key-value",
    label: field.label,
    helpText: field.helpText || "Add the information using guided fields.",
  };
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => {
    let initialCounter = 0;
    return draftFromValue(
      config.kind,
      parseStructuredValue(value, config.kind),
      (prefix) => `${prefix}-initial-${++initialCounter}`,
    );
  });

  const resetAndOpen = () => {
    setDraft(
      draftFromValue(
        config.kind,
        parseStructuredValue(value, config.kind),
        nextId,
      ),
    );
    setOpen(true);
  };

  const save = () => {
    onChange(serializedDraft(draft));
    setOpen(false);
  };

  const optionKey = field.structuredOptionsKey || config.optionsKey;
  const listOptions = optionKey ? options[optionKey] || [] : [];
  const panel = {
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  } as const;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Configure ${config.label}`}
        onPress={resetAndOpen}
        style={panel}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={{ ...type.label, color: colors.text }}>
              {config.label}{field.required ? " *" : ""}
            </Text>
            <Text style={{ ...type.caption, color: colors.textMuted }}>
              {field.helpText || config.helpText}
            </Text>
          </View>
          <Ionicons name="options-outline" size={21} color={colors.primary} />
        </View>
        <Text style={{ ...type.caption, color: colors.primary }}>
          {structuredValueSummary(value, config.label)} · Configure
        </Text>
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
          <View style={{ flexDirection: "row", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
            <View style={{ flex: 1 }}>
              <Text style={{ ...type.caption, color: colors.primary, textTransform: "uppercase" }}>Guided configuration</Text>
              <Text style={{ ...type.heading, color: colors.text }}>{config.label}</Text>
            </View>
            <Pressable accessibilityLabel="Close configuration" onPress={() => setOpen(false)} style={{ padding: spacing.sm }}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
            <Text style={{ ...type.body, color: colors.textMuted }}>{field.helpText || config.helpText}</Text>

            {draft.kind === "list" ? (
              <View style={{ gap: spacing.sm }}>
                {listOptions.length ? (
                  listOptions.map((option) => {
                    const selected = draft.items.some((item) => item.value === option.id);
                    return (
                      <Pressable
                        key={option.id}
                        onPress={() =>
                          setDraft((current) =>
                            current.kind === "list"
                              ? {
                                  ...current,
                                  items: selected
                                    ? current.items.filter((item) => item.value !== option.id)
                                    : [...current.items, { id: nextId("item"), value: option.id }],
                                }
                              : current,
                          )
                        }
                        style={{ ...panel, minHeight: 52, flexDirection: "row", alignItems: "center" }}
                      >
                        <Text style={{ ...type.label, flex: 1, color: colors.text }}>{option.name}</Text>
                        <Ionicons name={selected ? "checkmark-circle" : "ellipse-outline"} size={22} color={selected ? colors.primary : colors.textMuted} />
                      </Pressable>
                    );
                  })
                ) : (
                  <>
                    {draft.items.map((item, index) => (
                      <View key={item.id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                        <Text style={{ ...type.caption, color: colors.textMuted }}>{index + 1}</Text>
                        <TextInput
                          accessibilityLabel={`${config.label} item ${index + 1}`}
                          value={item.value}
                          onChangeText={(next) =>
                            setDraft((current) =>
                              current.kind === "list"
                                ? {
                                    ...current,
                                    items: current.items.map((entry) => entry.id === item.id ? { ...entry, value: next } : entry),
                                  }
                                : current,
                            )
                          }
                          placeholder="Add an item"
                          placeholderTextColor={colors.textMuted}
                          style={{ ...type.body, flex: 1, minHeight: 48, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, backgroundColor: colors.surface, color: colors.text }}
                        />
                        <Pressable accessibilityLabel={`Remove item ${index + 1}`} onPress={() => setDraft((current) => current.kind === "list" ? { ...current, items: current.items.filter((entry) => entry.id !== item.id) } : current)} style={{ padding: spacing.sm }}>
                          <Ionicons name="trash-outline" size={20} color={colors.danger} />
                        </Pressable>
                      </View>
                    ))}
                    <Button label="Add item" variant="secondary" onPress={() => setDraft((current) => current.kind === "list" ? { ...current, items: [...current.items, { id: nextId("item"), value: "" }] } : current)} />
                  </>
                )}
              </View>
            ) : null}

            {draft.kind === "key-value" ? (
              <View style={{ gap: spacing.sm }}>
                {draft.pairs.map((pair, index) => (
                  <View key={pair.id} style={panel}>
                    <Text style={{ ...type.caption, color: colors.textMuted }}>Detail {index + 1}</Text>
                    <TextInput
                      accessibilityLabel={`Label ${index + 1}`}
                      value={pair.key}
                      onChangeText={(key) => setDraft((current) => current.kind === "key-value" ? { ...current, pairs: current.pairs.map((entry) => entry.id === pair.id ? { ...entry, key } : entry) } : current)}
                      placeholder="Field or label"
                      placeholderTextColor={colors.textMuted}
                      style={{ ...type.body, minHeight: 48, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, color: colors.text }}
                    />
                    <TextInput
                      accessibilityLabel={`Value ${index + 1}`}
                      value={pair.value}
                      onChangeText={(next) => setDraft((current) => current.kind === "key-value" ? { ...current, pairs: current.pairs.map((entry) => entry.id === pair.id ? { ...entry, value: next } : entry) } : current)}
                      placeholder="Value"
                      placeholderTextColor={colors.textMuted}
                      style={{ ...type.body, minHeight: 48, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, color: colors.text }}
                    />
                    <Button label="Remove detail" variant="quiet" onPress={() => setDraft((current) => current.kind === "key-value" ? { ...current, pairs: current.pairs.filter((entry) => entry.id !== pair.id) } : current)} />
                  </View>
                ))}
                <Button label="Add labelled value" variant="secondary" onPress={() => setDraft((current) => current.kind === "key-value" ? { ...current, pairs: [...current.pairs, { id: nextId("pair"), key: "", value: "" }] } : current)} />
              </View>
            ) : null}

            {draft.kind === "actions" ? (
              <View style={{ gap: spacing.md }}>
                {draft.actions.map((action, actionIndex) => {
                  const typePair = action.pairs.find((pair) => pair.key === "type");
                  return (
                    <View key={action.id} style={panel}>
                      <Text style={{ ...type.heading, color: colors.text }}>Action {actionIndex + 1}</Text>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
                        {actionTypes.map(([actionType, label]) => {
                          const selected = typePair?.value === actionType;
                          return (
                            <Pressable
                              key={actionType}
                              onPress={() =>
                                setDraft((current) =>
                                  current.kind === "actions"
                                    ? {
                                        ...current,
                                        actions: current.actions.map((entry) =>
                                          entry.id === action.id
                                            ? {
                                                ...entry,
                                                pairs: [
                                                  { id: typePair?.id || nextId("pair"), key: "type", value: actionType },
                                                  ...entry.pairs.filter((pair) => pair.key !== "type"),
                                                ],
                                              }
                                            : entry,
                                        ),
                                      }
                                    : current,
                                )
                              }
                              style={{ minHeight: 40, justifyContent: "center", paddingHorizontal: spacing.md, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, borderRadius: 20, backgroundColor: selected ? colors.primarySoft : colors.surface }}
                            >
                              <Text style={{ ...type.caption, color: selected ? colors.primary : colors.textSecondary }}>{label}</Text>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                      {action.pairs.filter((pair) => pair.key !== "type").map((pair, pairIndex) => (
                        <View key={pair.id} style={{ gap: spacing.xs }}>
                          <TextInput
                            accessibilityLabel={`Action setting ${pairIndex + 1}`}
                            value={pair.key}
                            onChangeText={(key) => setDraft((current) => current.kind === "actions" ? { ...current, actions: current.actions.map((entry) => entry.id === action.id ? { ...entry, pairs: entry.pairs.map((item) => item.id === pair.id ? { ...item, key } : item) } : entry) } : current)}
                            placeholder="Setting"
                            placeholderTextColor={colors.textMuted}
                            style={{ ...type.body, minHeight: 48, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, color: colors.text }}
                          />
                          <TextInput
                            accessibilityLabel={`Action value ${pairIndex + 1}`}
                            value={pair.value}
                            onChangeText={(next) => setDraft((current) => current.kind === "actions" ? { ...current, actions: current.actions.map((entry) => entry.id === action.id ? { ...entry, pairs: entry.pairs.map((item) => item.id === pair.id ? { ...item, value: next } : item) } : entry) } : current)}
                            placeholder="Value"
                            placeholderTextColor={colors.textMuted}
                            style={{ ...type.body, minHeight: 48, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, color: colors.text }}
                          />
                        </View>
                      ))}
                      <Button label="Add action setting" variant="secondary" onPress={() => setDraft((current) => current.kind === "actions" ? { ...current, actions: current.actions.map((entry) => entry.id === action.id ? { ...entry, pairs: [...entry.pairs, { id: nextId("pair"), key: "", value: "" }] } : entry) } : current)} />
                      <Button label="Remove action" variant="quiet" onPress={() => setDraft((current) => current.kind === "actions" ? { ...current, actions: current.actions.filter((entry) => entry.id !== action.id) } : current)} />
                    </View>
                  );
                })}
                <Button label="Add action" variant="secondary" onPress={() => setDraft((current) => current.kind === "actions" ? { ...current, actions: [...current.actions, { id: nextId("action"), pairs: [{ id: nextId("pair"), key: "type", value: "" }] }] } : current)} />
              </View>
            ) : null}

            {draft.kind === "schedule" ? (
              <View style={{ gap: spacing.sm }}>
                {dayNames.map(([key, label]) => {
                  const day = scheduleDay(draft.days, key);
                  return (
                    <View key={key} style={panel}>
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        <Text style={{ ...type.label, flex: 1, color: colors.text }}>{label}</Text>
                        <Switch value={day.enabled} onValueChange={(enabled) => setDraft((current) => updateScheduleDay(current, key, { enabled }))} trackColor={{ true: colors.primary }} />
                      </View>
                      {day.enabled ? (
                        <View style={{ flexDirection: "row", gap: spacing.sm }}>
                          <TextInput value={day.start} onChangeText={(start) => setDraft((current) => updateScheduleDay(current, key, { start }))} placeholder="09:00" style={{ ...type.body, flex: 1, minHeight: 48, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, color: colors.text }} />
                          <TextInput value={day.end} onChangeText={(end) => setDraft((current) => updateScheduleDay(current, key, { end }))} placeholder="17:00" style={{ ...type.body, flex: 1, minHeight: 48, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, color: colors.text }} />
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : null}

            {draft.kind === "value" ? (
              <View style={panel}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
                  {(["string", "number", "boolean", "null"] as ValueType[]).map((valueType) => {
                    const selected = draft.valueType === valueType;
                    return (
                      <Pressable key={valueType} onPress={() => setDraft((current) => current.kind === "value" ? { ...current, valueType, value: valueType === "boolean" ? "false" : valueType === "null" ? "" : current.value } : current)} style={{ minHeight: 40, justifyContent: "center", paddingHorizontal: spacing.md, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, borderRadius: 20, backgroundColor: selected ? colors.primarySoft : colors.surface }}>
                        <Text style={{ ...type.caption, color: selected ? colors.primary : colors.textSecondary }}>{valueType === "string" ? "Text" : valueType === "boolean" ? "Yes / no" : valueType === "null" ? "No value" : "Number"}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                {draft.valueType === "boolean" ? (
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    {["false", "true"].map((choice) => <Button key={choice} style={{ flex: 1 }} label={choice === "true" ? "Yes" : "No"} variant={draft.value === choice ? "primary" : "secondary"} onPress={() => setDraft((current) => current.kind === "value" ? { ...current, value: choice } : current)} />)}
                  </View>
                ) : draft.valueType !== "null" ? (
                  <TextInput value={draft.value} onChangeText={(next) => setDraft((current) => current.kind === "value" ? { ...current, value: next } : current)} keyboardType={draft.valueType === "number" ? "decimal-pad" : "default"} placeholder="Value" placeholderTextColor={colors.textMuted} style={{ ...type.body, minHeight: 48, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, color: colors.text }} />
                ) : null}
              </View>
            ) : null}

            <Button label="Save configuration" onPress={save} />
            <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} />
            <Text style={{ ...type.caption, color: colors.textMuted, textAlign: "center" }}>
              The ERP stores this information as structured data automatically.
            </Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}
