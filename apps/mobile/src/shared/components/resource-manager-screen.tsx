import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MobileFieldDefinition,
  MobileResourceDefinition,
} from "@vercentlabs/shared-sdk";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Share,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { mobileApi } from "@/core/api/client";
import { useAuth } from "@/core/auth/auth-provider";
import { AppHeader } from "@/shared/components/app-header";
import { Button } from "@/shared/components/button";
import { QueryState, StatusPill } from "@/shared/components/crm-states";
import { Screen } from "@/shared/components/screen";
import { StructuredFieldEditor } from "@/shared/components/structured-field-editor";
import { useTheme } from "@/shared/theme/theme";

type Row = Record<string, unknown>;
type Option = { id: string; name: string };
type ResourceResponse = {
  definition: MobileResourceDefinition;
  rows?: Row[];
  total?: number;
  records?: { rows: Row[]; total: number };
  options?: Record<string, Option[]>;
};

function dateValue(value: unknown, includeTime = false) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, includeTime ? 16 : 10);
}

function initialForm(fields: MobileFieldDefinition[], row: Row) {
  return Object.fromEntries(
    fields.map((field) => {
      const value = row[field.name];
      if (field.type === "checkbox") return [field.name, Boolean(value)];
      if (field.type === "date") return [field.name, dateValue(value)];
      if (field.type === "datetime-local") return [field.name, dateValue(value, true)];
      if (value !== null && value !== undefined)
        return [
          field.name,
          typeof value === "object" ? JSON.stringify(value) : String(value),
        ];
      if (field.type === "number") {
        const sensible =
          field.name === "fiscalYearStartMonth"
            ? "4"
            : field.name === "padding"
              ? "5"
              : field.name === "nextNumber"
                ? "1"
                : "0";
        return [field.name, sensible];
      }
      return [field.name, field.options?.[0]?.value ?? ""];
    }),
  );
}

function visible(value: unknown, format?: string) {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value))
    return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  if (typeof value === "object") {
    const count = Object.keys(value as Record<string, unknown>).length;
    return `${count} ${count === 1 ? "value" : "values"} configured`;
  }
  if (format === "boolean") return value ? "Yes" : "No";
  if (format === "currency") {
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(value));
  }
  if (format === "date" || format === "datetime") {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat(
        "en-IN",
        format === "date"
          ? { dateStyle: "medium" }
          : { dateStyle: "medium", timeStyle: "short" },
      ).format(date);
    }
  }
  return String(value).replaceAll("_", " ");
}

function areaApi(area: string): "crm" | "business-data" | "settings" {
  if (area === "master-data") return "business-data";
  if (area === "crm" || area === "settings") return area;
  throw new Error("Unknown workspace resource area.");
}

const statuses = ["all", "new", "contacted", "working", "qualified", "unqualified", "converted", "open", "won", "lost", "planned", "active", "paused", "completed", "cancelled", "inactive", "archived"];

export function ResourceManagerScreen({ area, resource, startCreating = false }: { area: string; resource: string; startCreating?: boolean }) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const { colors, radii, spacing, type } = useTheme();
  const apiArea = areaApi(area);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [editor, setEditor] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, string | boolean>>({});
  const [selecting, setSelecting] = useState<MobileFieldDefinition | null>(null);
  const [importing, setImporting] = useState(false);
  const [csv, setCsv] = useState("");
  const openedCreate = useRef(false);
  const query = useQuery({
    queryKey: ["workspace-resource", apiArea, resource],
    queryFn: () =>
      mobileApi.listWorkspaceResource<ResourceResponse>(apiArea, resource, {
        limit: 500,
        status: "all",
      }),
  });
  const definition = query.data?.definition;
  const rows = query.data?.records?.rows ?? query.data?.rows ?? [];
  const options = query.data?.options ?? {};
  const permission = definition?.managePermission || definition?.permission;
  const canManage = Boolean(
    definition &&
      (!permission || auth.session?.access.permissions.includes(permission)),
  );
  const filtered = (() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) =>
      (status === "all" || String(row.status || "") === status) &&
      (!term || Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(term))),
    );
  })();

  const mutation = useMutation({
    mutationFn: async (input: { kind: "save" | "archive" | "complete"; row: Row; body?: Row }) => {
      const id = String(input.row.id || "");
      if (input.kind === "complete") return mobileApi.completeActivity(id, String(input.body?.outcome || ""));
      if (input.kind === "archive") {
        if (apiArea === "settings") throw new Error("Settings records cannot be archived here.");
        return mobileApi.archiveWorkspaceResource(apiArea, resource, id);
      }
      if (id) return mobileApi.updateWorkspaceResource(apiArea, resource, id, input.body || {});
      return mobileApi.createWorkspaceResource(apiArea, resource, input.body || {});
    },
    onSuccess: async (result) => {
      const message = (result as { message?: string }).message || "Record saved.";
      setEditor(null);
      await queryClient.invalidateQueries({ queryKey: ["workspace-resource", apiArea, resource] });
      Alert.alert("Completed", message);
    },
    onError: (error) => Alert.alert("Request not completed", error.message),
  });

  const openEditor = (row: Row) => {
    if (!definition) return;
    setEditor(row);
    setForm(initialForm(definition.fields, row));
  };

  useEffect(() => {
    if (startCreating && definition && canManage && !openedCreate.current) {
      openedCreate.current = true;
      setEditor({});
      setForm(initialForm(definition.fields, {}));
    }
  }, [canManage, definition, startCreating]);

  const exportCsv = async () => {
    try {
      const result = await mobileApi.request<{ csv: string; filename: string; rowCount: number }>(`/exports/${apiArea}/${resource}`);
      await Share.share({ title: result.filename, message: result.csv });
    } catch (error) {
      Alert.alert("Export not completed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const importCsv = async () => {
    try {
      const result = await mobileApi.request<{ message: string }>(`/imports/crm/${resource}`, { method: "POST", body: JSON.stringify({ csv }) });
      setImporting(false);
      setCsv("");
      await queryClient.invalidateQueries({ queryKey: ["workspace-resource", apiArea, resource] });
      Alert.alert("Import completed", result.message);
    } catch (error) {
      Alert.alert("Import not completed", error instanceof Error ? error.message : "Please check the CSV and try again.");
    }
  };

  const save = () => {
    if (!definition || !editor) return;
    const missing = definition.fields.find(
      (field) => field.required && String(form[field.name] ?? "").trim() === "",
    );
    if (missing) {
      Alert.alert("Required field", `Enter ${missing.label.toLowerCase()}.`);
      return;
    }
    const body: Row = {};
    for (const field of definition.fields) {
      const value = form[field.name];
      body[field.name] =
        field.type === "checkbox"
          ? Boolean(value)
          : value === "" && field.optionsKey
            ? null
            : String(value ?? "");
    }
    mutation.mutate({ kind: "save", row: editor, body });
  };

  const optionLabel = (column: { optionsKey?: string }, value: unknown) => {
    if (!column.optionsKey) return null;
    return options[column.optionsKey]?.find((item) => item.id === String(value))?.name || null;
  };

  return (
    <Screen>
      <AppHeader
        eyebrow={definition?.eyebrow || definition?.group || (area === "crm" ? "CRM" : "Master data")}
        title={definition?.title || "Workspace records"}
        description={definition?.description}
      />
      <QueryState loading={query.isLoading} error={query.error} empty={false} onRetry={() => void query.refetch()} />
      {definition ? (
        <View style={{ gap: spacing.md }}>
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <View
              style={{
                minHeight: 48,
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.xs,
                paddingHorizontal: spacing.md,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radii.sm,
                backgroundColor: colors.surface,
              }}
            >
              <Ionicons name="search" size={19} color={colors.textMuted} />
              <TextInput
                accessibilityLabel={`Search ${definition.title}`}
                placeholder={`Search ${definition.title.toLowerCase()}`}
                placeholderTextColor={colors.textMuted}
                value={search}
                onChangeText={setSearch}
                style={{ ...type.body, flex: 1, color: colors.text, paddingVertical: 0 }}
              />
            </View>
            {canManage ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={resource === "organization" ? "Edit organisation" : `Add ${definition.singular || "record"}`}
                onPress={() => openEditor(resource === "organization" ? rows[0] || {} : {})}
                style={{
                  width: 48,
                  height: 48,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radii.sm,
                  backgroundColor: colors.primary,
                }}
              >
                <Ionicons name={resource === "organization" ? "create-outline" : "add"} size={22} color={colors.inverse} />
              </Pressable>
            ) : null}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs }}>
            {statuses.map((value) => <Pressable key={value} onPress={() => setStatus(value)} style={{ minHeight: 38, justifyContent: "center", paddingHorizontal: spacing.md, borderWidth: 1, borderColor: status === value ? colors.primary : colors.border, borderRadius: 19, backgroundColor: status === value ? colors.primarySoft : colors.surface }}><Text style={{ ...type.caption, color: status === value ? colors.primary : colors.textMuted }}>{value.replaceAll("_", " ")}</Text></Pressable>)}
          </ScrollView>
          {apiArea !== "settings" ? <View style={{ flexDirection: "row", gap: spacing.sm }}><Button style={{ flex: 1 }} label="Export CSV" variant="secondary" onPress={() => void exportCsv()} />{apiArea === "crm" && auth.session?.access.permissions.includes("crm.import") && canManage ? <Button style={{ flex: 1 }} label="Import CSV" variant="secondary" onPress={() => setImporting(true)} /> : null}</View> : null}
          <Text style={{ ...type.caption, color: colors.textMuted }}>
            {filtered.length} {filtered.length === 1 ? "record" : "records"} · {canManage ? "Manage access" : "Read only"}
          </Text>
          {filtered.map((row) => (
            <View
              key={String(row.id)}
              style={{
                padding: spacing.md,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: radii.md,
                backgroundColor: colors.surface,
                gap: spacing.md,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ ...type.label, color: colors.text }}>
                    {String(row.name || row.fullName || row.displayName || row.subject || row.code || row.id)}
                  </Text>
                  <Text numberOfLines={1} style={{ ...type.caption, color: colors.textMuted }}>
                    {String(row.code || row.email || row.companyName || definition.singular || "Record")}
                  </Text>
                </View>
                {row.status ? <StatusPill value={String(row.status)} /> : null}
              </View>
              <View style={{ gap: spacing.xs }}>
                {(definition.columns?.length
                  ? definition.columns
                  : definition.fields.map((field) => ({
                      key: field.name,
                      label: field.label,
                      optionsKey: field.optionsKey,
                      format: undefined,
                    })))
                  .filter((column) => !["name", "fullName", "displayName", "subject", "code", "status"].includes(column.key))
                  .slice(0, 5)
                  .map((column) => (
                    <View key={column.key} style={{ flexDirection: "row", gap: spacing.sm }}>
                      <Text style={{ ...type.caption, width: 112, color: colors.textMuted }}>{column.label}</Text>
                      <Text style={{ ...type.caption, flex: 1, color: colors.textSecondary }}>
                        {optionLabel(column, row[column.key]) || visible(row[column.key], column.format)}
                      </Text>
                    </View>
                  ))}
              </View>
              {canManage || (apiArea === "crm" && (resource === "leads" || resource === "opportunities")) ? (
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  {apiArea === "crm" && (resource === "leads" || resource === "opportunities") ? <Pressable onPress={() => router.push({ pathname: "/(protected)/crm/[resource]/[id]", params: { resource, id: String(row.id) } })} style={{ minHeight: 44, flex: 1, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm }}><Text style={{ ...type.label, color: colors.primary }}>Open</Text></Pressable> : null}
                  {canManage && apiArea === "crm" && resource === "activities" && row.status !== "completed" ? <Pressable onPress={() => mutation.mutate({ kind: "complete", row, body: { outcome: "Completed from mobile" } })} style={{ minHeight: 44, flex: 1, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm }}><Text style={{ ...type.label, color: colors.primary }}>Complete</Text></Pressable> : null}
                  {canManage ? <Pressable onPress={() => openEditor(row)} style={{ minHeight: 44, flex: 1, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm }}>
                    <Text style={{ ...type.label, color: colors.primary }}>Edit</Text>
                  </Pressable> : null}
                  {canManage && apiArea !== "settings" ? (
                    <Pressable
                      onPress={() =>
                        Alert.alert("Archive record?", "Existing references will be preserved.", [
                          { text: "Cancel", style: "cancel" },
                          { text: "Archive", style: "destructive", onPress: () => mutation.mutate({ kind: "archive", row }) },
                        ])
                      }
                      style={{ minHeight: 44, flex: 1, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.danger, borderRadius: radii.sm }}
                    >
                      <Text style={{ ...type.label, color: colors.danger }}>Archive</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          ))}
          {!filtered.length ? (
            <View style={{ padding: spacing.xl, alignItems: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface }}>
              <Text style={{ ...type.heading, color: colors.text }}>No matching records</Text>
              <Text style={{ ...type.body, color: colors.textMuted }}>Change the search or create the first record.</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <Modal visible={Boolean(editor && definition)} animationType="slide" onRequestClose={() => setEditor(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
          <View style={{ flexDirection: "row", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
            <View style={{ flex: 1 }}>
              <Text style={{ ...type.caption, color: colors.primary, textTransform: "uppercase" }}>{editor?.id ? "Edit record" : "New record"}</Text>
              <Text style={{ ...type.heading, color: colors.text }}>{definition?.title}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close editor" onPress={() => setEditor(null)} style={{ padding: spacing.sm }}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}>
            {definition?.fields.map((field) => {
              const choices =
                field.options ||
                (field.optionsKey
                  ? (options[field.optionsKey] || []).map((item) => ({ value: item.id, label: item.name }))
                  : []);
              if (field.structuredKind) {
                return (
                  <StructuredFieldEditor
                    key={field.name}
                    field={field}
                    value={form[field.name]}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        [field.name]: value,
                      }))
                    }
                    options={options}
                  />
                );
              }
              if (field.type === "checkbox") {
                return (
                  <View key={field.name} style={{ minHeight: 52, flexDirection: "row", alignItems: "center", padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, backgroundColor: colors.surface }}>
                    <Text style={{ ...type.label, flex: 1, color: colors.text }}>{field.label}</Text>
                    <Switch value={Boolean(form[field.name])} onValueChange={(value) => setForm((current) => ({ ...current, [field.name]: value }))} trackColor={{ true: colors.primary }} />
                  </View>
                );
              }
              if (field.type === "select") {
                const selected = choices.find((choice) => choice.value === String(form[field.name] ?? ""));
                return (
                  <Pressable key={field.name} onPress={() => setSelecting(field)} style={{ minHeight: 70, justifyContent: "center", paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, backgroundColor: colors.surface }}>
                    <Text style={{ ...type.caption, color: colors.textMuted }}>{field.label}{field.required ? " *" : ""}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <Text style={{ ...type.body, flex: 1, color: selected ? colors.text : colors.textMuted }}>{selected?.label || "Select"}</Text>
                      <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
                    </View>
                  </Pressable>
                );
              }
              return (
                <View key={field.name} style={{ gap: 5 }}>
                  <Text style={{ ...type.caption, color: colors.textSecondary }}>{field.label}{field.required ? " *" : ""}</Text>
                  <TextInput
                    value={String(form[field.name] ?? "")}
                    onChangeText={(value) => setForm((current) => ({ ...current, [field.name]: value }))}
                    multiline={field.type === "textarea"}
                    keyboardType={field.type === "number" ? "decimal-pad" : field.type === "email" ? "email-address" : "default"}
                    autoCapitalize={field.type === "email" ? "none" : "sentences"}
                    style={{
                      ...type.body,
                      minHeight: field.type === "textarea" ? 104 : 48,
                      paddingHorizontal: spacing.md,
                      paddingVertical: field.type === "textarea" ? spacing.sm : 0,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radii.sm,
                      backgroundColor: colors.surface,
                      color: colors.text,
                      textAlignVertical: field.type === "textarea" ? "top" : "center",
                    }}
                  />
                </View>
              );
            })}
            <Button label={mutation.isPending ? "Saving…" : "Save"} disabled={mutation.isPending} onPress={save} />
            <Button label="Cancel" variant="secondary" onPress={() => setEditor(null)} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={Boolean(selecting)} transparent animationType="slide" onRequestClose={() => setSelecting(null)}>
        <SafeAreaView style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(11,18,32,0.34)" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setSelecting(null)} />
          <View style={{ maxHeight: "68%", padding: spacing.lg, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, backgroundColor: colors.surface }}>
            <Text style={{ ...type.heading, color: colors.text }}>{selecting?.label}</Text>
            <ScrollView style={{ marginTop: spacing.sm }}>
              {[{ value: "", label: "Not selected" }, ...(
                selecting?.options ||
                (selecting?.optionsKey
                  ? (options[selecting.optionsKey] || []).map((item) => ({ value: item.id, label: item.name }))
                  : [])
              )].map((choice) => (
                <Pressable
                  key={choice.value || "empty"}
                  onPress={() => {
                    if (selecting) setForm((current) => ({ ...current, [selecting.name]: choice.value }));
                    setSelecting(null);
                  }}
                  style={{ minHeight: 52, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.border }}
                >
                  <Text style={{ ...type.label, flex: 1, color: colors.text }}>{choice.label}</Text>
                  {String(form[selecting?.name || ""] ?? "") === choice.value ? <Ionicons name="checkmark-circle" size={21} color={colors.primary} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>

      <Modal visible={importing} animationType="slide" onRequestClose={() => setImporting(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
          <View style={{ flexDirection: "row", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}><View style={{ flex: 1 }}><Text style={{ ...type.caption, color: colors.primary, textTransform: "uppercase" }}>Governed import</Text><Text style={{ ...type.heading, color: colors.text }}>Import {definition?.title} CSV</Text></View><Pressable onPress={() => setImporting(false)}><Ionicons name="close" size={24} color={colors.textSecondary} /></Pressable></View>
          <View style={{ flex: 1, padding: spacing.md, gap: spacing.md }}><Text style={{ ...type.body, color: colors.textMuted }}>Paste CSV content with a header row. Up to 1,000 records and 2 MB are accepted, matching the web import contract.</Text><TextInput value={csv} onChangeText={setCsv} multiline autoCapitalize="none" autoCorrect={false} placeholder="name,email,status&#10;Example,team@example.com,new" placeholderTextColor={colors.textMuted} style={{ ...type.body, flex: 1, minHeight: 240, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, color: colors.text, textAlignVertical: "top" }} /><Button label="Import CSV" disabled={!csv.trim()} onPress={() => void importCsv()} /><Button label="Cancel" variant="secondary" onPress={() => setImporting(false)} /></View>
        </SafeAreaView>
      </Modal>
    </Screen>
  );
}
