import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, router } from "expo-router";
import { Linking, Pressable, RefreshControl, Text, View } from "react-native";
import { useState } from "react";
import * as Crypto from "expo-crypto";
import { mobileApi } from "@/core/api/client";
import { useCrmQuery } from "@/modules/crm/hooks/use-crm-query";
import { useTheme } from "@/shared/theme/theme";
import { QueryState, StatusPill } from "@/shared/components/crm-states";
import { Screen } from "@/shared/components/screen";

const allowed = new Set(["leads", "opportunities", "activities"]);
const hidden = new Set(["id", "organizationId", "companyId", "branchId", "createdBy", "updatedBy", "deletedAt"]);
const preferred = ["code", "fullName", "name", "subject", "companyName", "email", "mobile", "phone", "status", "priority", "rating", "score", "amount", "estimatedValue", "probability", "expectedCloseDate", "nextFollowUpAt", "activityType", "dueAt", "description", "industry", "city", "state", "website", "productInterest", "createdAt", "updatedAt"];
const label = (key: string) => key.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase());
const value = (input: unknown) => typeof input === "boolean" ? (input ? "Yes" : "No") : input == null || input === "" ? "—" : String(input);

export default function RecordDetailScreen() {
  const params = useLocalSearchParams<{ resource: string; id: string }>();
  const resource = allowed.has(params.resource) ? params.resource as "leads" | "opportunities" | "activities" : "leads";
  const { colors, radii, spacing, type } = useTheme();
  const query = useCrmQuery(`${resource}:${params.id}`, () => mobileApi.getCrm(resource, params.id));
  const stagesQuery = useCrmQuery("pipeline-stages:detail", () => mobileApi.listCrm("pipeline-stages", { limit: 100 }));
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const record = query.data?.record;
  const title = String(record?.fullName ?? record?.name ?? record?.subject ?? "CRM record");
  const keys = record ? [...preferred.filter((key) => key in record), ...Object.keys(record).filter((key) => !preferred.includes(key))].filter((key) => !hidden.has(key) && typeof record[key] !== "object") : [];
  const contact = String(record?.mobile ?? record?.phone ?? "");
  const email = String(record?.email ?? "");
  async function move(stageId: string) { setBusy(true); setMessage(""); try { await mobileApi.moveOpportunity(params.id, stageId, undefined, Crypto.randomUUID()); await query.refetch(); setMessage("Pipeline stage updated."); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update stage."); } finally { setBusy(false); } }
  async function complete() { setBusy(true); setMessage(""); try { await mobileApi.completeActivity(params.id, undefined, Crypto.randomUUID()); await query.refetch(); setMessage("Activity completed."); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not complete activity."); } finally { setBusy(false); } }
  return <Screen refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.xl }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={{ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}><Ionicons name="arrow-back" size={22} color={colors.text} /></Pressable>
      <View style={{ flex: 1 }}><Text style={{ ...type.caption, color: colors.primary, textTransform: "uppercase" }}>{resource.replace("opportunities", "Opportunity").replace("activities", "Activity").replace("leads", "Lead")}</Text><Text numberOfLines={2} accessibilityRole="header" style={{ ...type.title, color: colors.text }}>{title}</Text></View>
      {record?.status ? <StatusPill value={String(record.status)} /> : null}
    </View>
    <QueryState loading={query.isLoading && !record} error={query.error} empty={!record} onRetry={() => void query.refetch()} />
    {record ? <>
      {(contact || email) ? <View style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg }}>
        {contact ? <Pressable onPress={() => void Linking.openURL(`tel:${contact}`)} style={{ flex: 1, minHeight: 52, borderRadius: radii.full, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: spacing.xs }}><Ionicons name="call" size={18} color={colors.inverse} /><Text style={{ ...type.label, color: colors.inverse }}>Call</Text></Pressable> : null}
        {email ? <Pressable onPress={() => void Linking.openURL(`mailto:${email}`)} style={{ flex: 1, minHeight: 52, borderRadius: radii.full, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: spacing.xs }}><Ionicons name="mail-outline" size={18} color={colors.primary} /><Text style={{ ...type.label, color: colors.text }}>Email</Text></Pressable> : null}
      </View> : null}
      {resource === "opportunities" && stagesQuery.data?.rows.length ? <View style={{ marginBottom: spacing.lg, gap: spacing.sm }}><Text style={{ ...type.label, color: colors.text }}>Move through pipeline</Text><View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>{stagesQuery.data.rows.map((stage) => <Pressable disabled={busy || stage.id === record.stageId} key={String(stage.id)} onPress={() => void move(String(stage.id))} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radii.full, backgroundColor: stage.id === record.stageId ? colors.navigation : colors.surface, borderWidth: 1, borderColor: stage.id === record.stageId ? colors.navigation : colors.border }}><Text style={{ ...type.caption, color: stage.id === record.stageId ? colors.inverse : colors.text }}>{String(stage.name)}</Text></Pressable>)}</View></View> : null}
      {resource === "activities" && record.status !== "completed" ? <Pressable disabled={busy} onPress={() => void complete()} style={{ minHeight: 52, marginBottom: spacing.lg, borderRadius: radii.full, backgroundColor: colors.primary, justifyContent: "center", alignItems: "center" }}><Text style={{ ...type.label, color: colors.inverse }}>{busy ? "Updating…" : "Mark activity complete"}</Text></Pressable> : null}
      {message ? <Text accessibilityRole="alert" style={{ ...type.body, color: message.includes("updated") || message.includes("completed") ? colors.success : colors.danger, marginBottom: spacing.md }}>{message}</Text> : null}
      <View style={{ borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
        {keys.map((key, index) => <View key={key} style={{ padding: spacing.md, borderTopWidth: index ? 1 : 0, borderTopColor: colors.border, gap: spacing.xxs }}><Text style={{ ...type.caption, color: colors.textMuted }}>{label(key)}</Text><Text selectable style={{ ...type.body, color: colors.text }}>{value(record[key])}</Text></View>)}
      </View>
      {query.isOfflineFallback ? <Text style={{ ...type.caption, color: colors.warning, marginTop: spacing.md }}>Showing encrypted offline data</Text> : null}
    </> : null}
  </Screen>;
}
