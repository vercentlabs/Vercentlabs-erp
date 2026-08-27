import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import {
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import { useState } from "react";
import * as Crypto from "expo-crypto";
import { mobileApi } from "@/core/api/client";
import { enqueueMutation } from "@/core/database/database";
import { useAuth } from "@/core/auth/auth-provider";
import { useCrmQuery } from "@/modules/crm/hooks/use-crm-query";
import { useTheme } from "@/shared/theme/theme";
import { QueryState, StatusPill } from "@/shared/components/crm-states";
import { AppHeader } from "@/shared/components/app-header";
import { Screen } from "@/shared/components/screen";

const allowed = new Set(["leads", "opportunities", "activities"]);
const hidden = new Set([
  "id",
  "organizationId",
  "companyId",
  "branchId",
  "createdBy",
  "updatedBy",
  "deletedAt",
]);
const preferred = [
  "code",
  "fullName",
  "name",
  "subject",
  "companyName",
  "email",
  "mobile",
  "phone",
  "status",
  "priority",
  "rating",
  "score",
  "amount",
  "estimatedValue",
  "probability",
  "expectedCloseDate",
  "nextFollowUpAt",
  "activityType",
  "dueAt",
  "description",
  "industry",
  "city",
  "state",
  "website",
  "productInterest",
  "createdAt",
  "updatedAt",
];
const label = (key: string) =>
  key.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase());
const value = (input: unknown) =>
  typeof input === "boolean"
    ? input
      ? "Yes"
      : "No"
    : input == null || input === ""
      ? "—"
      : String(input);

export default function RecordDetailScreen() {
  const auth = useAuth();
  const params = useLocalSearchParams<{ resource: string; id: string }>();
  const resource = allowed.has(params.resource)
    ? (params.resource as "leads" | "opportunities" | "activities")
    : "leads";
  const { colors, radii, spacing, type } = useTheme();
  const query = useCrmQuery(`${resource}:${params.id}`, () =>
    mobileApi.getCrm(resource, params.id),
  );
  const stagesQuery = useCrmQuery("pipeline-stages:detail", () =>
    mobileApi.listCrm("stages", { limit: 100 }),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const record = query.data?.record;
  const related = query.data?.related ?? {};
  const title = String(
    record?.fullName ?? record?.name ?? record?.subject ?? "CRM record",
  );
  const keys = record
    ? [
        ...preferred.filter((key) => key in record),
        ...Object.keys(record).filter((key) => !preferred.includes(key)),
      ].filter((key) => !hidden.has(key) && typeof record[key] !== "object")
    : [];
  const isCall = resource === "activities" && String(record?.activityType || "").toLowerCase() === "call";
  const isMeeting = resource === "activities" && String(record?.activityType || "").toLowerCase() === "meeting";
  const contact = String(record?.callPhone ?? record?.mobile ?? record?.phone ?? "");
  const email = String(record?.email ?? "");
  const permissions = new Set(auth.session?.access.permissions || []);
  const canManageLead = permissions.has("crm.leads.manage");
  const canManageOpportunity = permissions.has("crm.opportunities.manage");
  const canManageActivity = permissions.has("crm.activities.manage");
  async function move(stageId: string) {
    setBusy(true);
    setMessage("");
    try {
      await mobileApi.moveOpportunity(
        params.id,
        stageId,
        undefined,
        Crypto.randomUUID(),
        {
          expectedUpdatedAt:
            typeof record?.updatedAt === "string" ? record.updatedAt : undefined,
          expectedStageId:
            typeof record?.stageId === "string" ? record.stageId : undefined,
        },
      );
      await query.refetch();
      setMessage("Pipeline stage updated.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not update stage.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function requestStageApproval(stageId: string) {
    setBusy(true);
    setMessage("");
    try {
      const result = await mobileApi.createApprovalRequest(
        "crm.opportunity.stage_change",
        {
          opportunityId: params.id,
          stageId,
          note: "Requested from native opportunity detail",
        },
        null,
        Crypto.randomUUID(),
      );
      setMessage(result.message || "Stage-change approval requested.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not request approval.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function complete() {
    setBusy(true);
    setMessage("");
    try {
      await mobileApi.completeActivity(
        params.id,
        undefined,
        Crypto.randomUUID(),
        {
          expectedUpdatedAt:
            typeof record?.updatedAt === "string" ? record.updatedAt : undefined,
          expectedStatus:
            typeof record?.status === "string" ? record.status : undefined,
        },
      );
      await query.refetch();
      setMessage("Activity completed.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not complete activity.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function completeCall(outcomeCode: string) {
    setBusy(true);
    setMessage("");
    const idempotencyKey = Crypto.randomUUID();
    const payload = {
      outcomeCode,
      expectedUpdatedAt: typeof record?.updatedAt === "string" ? record.updatedAt : undefined,
      expectedStatus: typeof record?.status === "string" ? record.status : undefined,
    };
    try {
      await mobileApi.completeCall(params.id, payload, idempotencyKey);
      await query.refetch();
      setMessage("Call completed.");
    } catch (error) {
      if ((error as { retryable?: boolean }).retryable !== false) {
        await enqueueMutation({ id: Crypto.randomUUID(), operation: "complete-call", resource: "activities", recordId: params.id, payload, idempotencyKey });
        setMessage("Saved offline. Call completion will sync automatically.");
      } else setMessage(error instanceof Error ? error.message : "Could not complete Call.");
    } finally {
      setBusy(false);
    }
  }

  async function callLifecycle(action: "start" | "cancel") {
    setBusy(true);
    setMessage("");
    const idempotencyKey = Crypto.randomUUID();
    const payload = {
      expectedUpdatedAt: typeof record?.updatedAt === "string" ? record.updatedAt : undefined,
      expectedStatus: typeof record?.status === "string" ? record.status : undefined,
    };
    try {
      if (action === "start") await mobileApi.startCall(params.id, payload, idempotencyKey);
      else await mobileApi.cancelCall(params.id, payload, idempotencyKey);
      await query.refetch();
      setMessage(action === "start" ? "Call started." : "Call cancelled.");
    } catch (error) {
      if ((error as { retryable?: boolean }).retryable !== false) {
        await enqueueMutation({ id: Crypto.randomUUID(), operation: `${action}-call`, resource: "activities", recordId: params.id, payload, idempotencyKey });
        setMessage(`Saved offline. Call ${action} will sync automatically.`);
      } else setMessage(error instanceof Error ? error.message : `Could not ${action} Call.`);
    } finally {
      setBusy(false);
    }
  }

  async function completeMeeting(outcomeCode: "held" | "no_show") {
    setBusy(true);
    setMessage("");
    const idempotencyKey = Crypto.randomUUID();
    const payload = {
      outcomeCode,
      expectedUpdatedAt: typeof record?.updatedAt === "string" ? record.updatedAt : undefined,
      expectedStatus: typeof record?.status === "string" ? record.status : undefined,
    };
    try {
      await mobileApi.completeMeeting(params.id, payload, idempotencyKey);
      await query.refetch();
      setMessage("Meeting completed.");
    } catch (error) {
      if ((error as { retryable?: boolean }).retryable !== false) {
        await enqueueMutation({ id: Crypto.randomUUID(), operation: "complete-meeting", resource: "activities", recordId: params.id, payload, idempotencyKey });
        setMessage("Saved offline. Meeting completion will sync automatically.");
      } else setMessage(error instanceof Error ? error.message : "Could not complete Meeting.");
    } finally {
      setBusy(false);
    }
  }

  async function meetingLifecycle(action: "start" | "cancel") {
    setBusy(true);
    setMessage("");
    const idempotencyKey = Crypto.randomUUID();
    const payload = {
      expectedUpdatedAt: typeof record?.updatedAt === "string" ? record.updatedAt : undefined,
      expectedStatus: typeof record?.status === "string" ? record.status : undefined,
    };
    try {
      if (action === "start") await mobileApi.startMeeting(params.id, payload, idempotencyKey);
      else await mobileApi.cancelMeeting(params.id, payload, idempotencyKey);
      await query.refetch();
      setMessage(action === "start" ? "Meeting started." : "Meeting cancelled.");
    } catch (error) {
      if ((error as { retryable?: boolean }).retryable !== false) {
        await enqueueMutation({ id: Crypto.randomUUID(), operation: `${action}-meeting`, resource: "activities", recordId: params.id, payload, idempotencyKey });
        setMessage(`Saved offline. Meeting ${action} will sync automatically.`);
      } else setMessage(error instanceof Error ? error.message : `Could not ${action} Meeting.`);
    } finally {
      setBusy(false);
    }
  }

  async function requestCompletionApproval() {
    setBusy(true);
    setMessage("");
    try {
      const result = await mobileApi.createApprovalRequest(
        "crm.activity.complete",
        { activityId: params.id, outcome: null },
        null,
        Crypto.randomUUID(),
      );
      setMessage(result.message || "Activity completion approval requested.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not request approval.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function convertLead() {
    setBusy(true);
    setMessage("");
    try {
      const result = await mobileApi.apiRequest<{ message?: string }>(
        `/crm/leads/${params.id}/convert`,
        { method: "POST", body: JSON.stringify({ createOpportunity: true }) },
      );
      await query.refetch();
      setMessage(result.message || "Lead converted.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not convert lead.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function mergeLead(targetLeadId: string) {
    setBusy(true);
    setMessage("");
    try {
      const result = await mobileApi.apiRequest<{ message?: string }>(
        `/crm/leads/${params.id}/merge`,
        { method: "POST", body: JSON.stringify({ targetLeadId }) },
      );
      setMessage(result.message || "Lead merged.");
      router.replace({
        pathname: "/(protected)/crm/[resource]/[id]",
        params: { resource: "leads", id: targetLeadId },
      });
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not merge lead.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={query.isFetching}
          onRefresh={() => void query.refetch()}
          tintColor={colors.primary}
        />
      }
    >
      <AppHeader
        eyebrow={`${resource.replace("opportunities", "Opportunity").replace("activities", "Activity").replace("leads", "Lead")}${record?.code ? ` · ${String(record.code)}` : ""}`}
        title={title}
        description={
          record
            ? String(
                record.nextStep ??
                  record.description ??
                  record.companyName ??
                  record.email ??
                  "CRM record detail",
              )
            : undefined
        }
      />
      {record?.status ? (
        <View style={{ alignSelf: "flex-start", marginBottom: spacing.md }}>
          <StatusPill value={String(record.status)} />
        </View>
      ) : null}
      <QueryState
        loading={query.isLoading && !record}
        error={query.error}
        empty={!record}
        onRetry={() => void query.refetch()}
      />
      {record ? (
        <>
          {contact || email ? (
            <View
              style={{
                flexDirection: "row",
                gap: spacing.sm,
                marginBottom: spacing.lg,
              }}
            >
              {contact ? (
                <Pressable
                  onPress={() => void Linking.openURL(`tel:${contact}`)}
                  style={{
                    flex: 1,
                    minHeight: 52,
                    borderRadius: radii.full,
                    backgroundColor: colors.primary,
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "row",
                    gap: spacing.xs,
                  }}
                >
                  <Ionicons name="call" size={18} color={colors.inverse} />
                  <Text style={{ ...type.label, color: colors.inverse }}>
                    Call
                  </Text>
                </Pressable>
              ) : null}
              {email ? (
                <Pressable
                  onPress={() => void Linking.openURL(`mailto:${email}`)}
                  style={{
                    flex: 1,
                    minHeight: 52,
                    borderRadius: radii.full,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "row",
                    gap: spacing.xs,
                  }}
                >
                  <Ionicons
                    name="mail-outline"
                    size={18}
                    color={colors.primary}
                  />
                  <Text style={{ ...type.label, color: colors.text }}>
                    Email
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {resource === "opportunities" &&
          canManageOpportunity &&
          stagesQuery.data?.rows.length ? (
            <View style={{ marginBottom: spacing.lg, gap: spacing.sm }}>
              <Text style={{ ...type.label, color: colors.text }}>
                Move through pipeline
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: spacing.xs,
                }}
              >
                {stagesQuery.data.rows.map((stage) => (
                  <Pressable
                    disabled={busy || stage.id === record.stageId}
                    key={String(stage.id)}
                    onPress={() =>
                      Alert.alert(
                        "Change opportunity stage",
                        `Move to ${String(stage.name)} now or request another authorised user to approve it.`,
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Request approval",
                            onPress: () =>
                              void requestStageApproval(String(stage.id)),
                          },
                          {
                            text: "Move now",
                            onPress: () => void move(String(stage.id)),
                          },
                        ],
                      )
                    }
                    style={{
                      minHeight: 44,
                      justifyContent: "center",
                      paddingHorizontal: spacing.md,
                      borderRadius: radii.full,
                      backgroundColor:
                        stage.id === record.stageId
                          ? colors.navigation
                          : colors.surface,
                      borderWidth: 1,
                      borderColor:
                        stage.id === record.stageId
                          ? colors.navigation
                          : colors.border,
                    }}
                  >
                    <Text
                      style={{
                        ...type.caption,
                        color:
                          stage.id === record.stageId
                            ? colors.inverse
                            : colors.text,
                      }}
                    >
                      {String(stage.name)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {isCall && canManageActivity && ["planned", "overdue"].includes(String(record.status)) ? (
            <View style={{ marginBottom: spacing.md, flexDirection: "row", gap: spacing.sm }}>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void callLifecycle("start")} style={{ flex: 1, minHeight: 48, justifyContent: "center", alignItems: "center", borderRadius: radii.full, backgroundColor: colors.primary }}>
                <Text style={{ ...type.label, color: colors.inverse }}>Start Call</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void callLifecycle("cancel")} style={{ flex: 1, minHeight: 48, justifyContent: "center", alignItems: "center", borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
                <Text style={{ ...type.label, color: colors.primary }}>Cancel Call</Text>
              </Pressable>
            </View>
          ) : null}
          {isCall && canManageActivity && record.status === "in_progress" ? (
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void callLifecycle("cancel")} style={{ minHeight: 48, marginBottom: spacing.md, justifyContent: "center", alignItems: "center", borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
              <Text style={{ ...type.label, color: colors.primary }}>Cancel Call</Text>
            </Pressable>
          ) : null}
          {isCall && canManageActivity && record.status !== "completed" && record.status !== "cancelled" ? (
            <View style={{ marginBottom: spacing.lg, gap: spacing.sm }}>
              <Text style={{ ...type.label, color: colors.text }}>Complete Call with outcome</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
                {[
                  ["connected", "Connected"],
                  ["no_answer", "No answer"],
                  ["busy", "Busy"],
                  ["voicemail", "Voicemail"],
                  ["callback_requested", "Callback"],
                  ["wrong_number", "Wrong number"],
                  ["failed", "Failed"],
                ].map(([code, labelText]) => (
                  <Pressable
                    key={code}
                    disabled={busy}
                    accessibilityRole="button"
                    onPress={() => { if (code) void completeCall(code); }}
                    style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}
                  >
                    <Text style={{ ...type.caption, color: colors.primary }}>{labelText}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {isMeeting && canManageActivity && ["planned", "overdue"].includes(String(record.status)) ? (
            <View style={{ marginBottom: spacing.md, flexDirection: "row", gap: spacing.sm }}>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void meetingLifecycle("start")} style={{ flex: 1, minHeight: 48, justifyContent: "center", alignItems: "center", borderRadius: radii.full, backgroundColor: colors.primary }}>
                <Text style={{ ...type.label, color: colors.inverse }}>Start Meeting</Text>
              </Pressable>
              {!record.bookingId ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void meetingLifecycle("cancel")} style={{ flex: 1, minHeight: 48, justifyContent: "center", alignItems: "center", borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
                <Text style={{ ...type.label, color: colors.primary }}>Cancel Meeting</Text>
              </Pressable> : null}
            </View>
          ) : null}
          {isMeeting && canManageActivity && record.status === "in_progress" && !record.bookingId ? (
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void meetingLifecycle("cancel")} style={{ minHeight: 48, marginBottom: spacing.md, justifyContent: "center", alignItems: "center", borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
              <Text style={{ ...type.label, color: colors.primary }}>Cancel Meeting</Text>
            </Pressable>
          ) : null}
          {isMeeting && canManageActivity && record.status !== "completed" && record.status !== "cancelled" ? (
            <View style={{ marginBottom: spacing.lg, gap: spacing.sm }}>
              <Text style={{ ...type.label, color: colors.text }}>Complete Meeting with outcome</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
                {([["held", "Held"], ["no_show", "No show"]] as const).map(([code, labelText]) => (
                  <Pressable key={code} disabled={busy} accessibilityRole="button" onPress={() => void completeMeeting(code)} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radii.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
                    <Text style={{ ...type.caption, color: colors.primary }}>{labelText}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {resource === "activities" &&
          canManageActivity &&
          !isCall &&
          !isMeeting &&
          record.status !== "completed" ? (
            <View style={{ marginBottom: spacing.lg, gap: spacing.sm }}>
              <Pressable
                disabled={busy}
                onPress={() => void complete()}
                style={{
                  minHeight: 52,
                  borderRadius: radii.full,
                  backgroundColor: colors.primary,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text style={{ ...type.label, color: colors.inverse }}>
                  {busy ? "Updating…" : "Mark activity complete"}
                </Text>
              </Pressable>
              <Pressable
                disabled={busy}
                onPress={() => void requestCompletionApproval()}
                style={{
                  minHeight: 52,
                  borderRadius: radii.full,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <Text style={{ ...type.label, color: colors.primary }}>
                  Request completion approval
                </Text>
              </Pressable>
            </View>
          ) : null}
          {resource === "leads" &&
          canManageLead &&
          record.recordStatus !== "converted" &&
          record.recordStatus !== "archived" ? (
            <Pressable
              disabled={busy}
              onPress={() =>
                Alert.alert(
                  "Convert lead?",
                  "Create the customer, contact and opportunity while preserving this history.",
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: "Convert", onPress: () => void convertLead() },
                  ],
                )
              }
              style={{
                minHeight: 52,
                marginBottom: spacing.lg,
                borderRadius: radii.sm,
                backgroundColor: colors.primary,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Text style={{ ...type.label, color: colors.inverse }}>
                {busy ? "Working…" : "Convert lead"}
              </Text>
            </Pressable>
          ) : null}
          {resource === "leads" &&
          canManageLead &&
          record.recordStatus !== "converted" &&
          record.recordStatus !== "archived" &&
          related.duplicates?.length ? (
            <View style={{ marginBottom: spacing.lg, gap: spacing.sm }}>
              <Text style={{ ...type.heading, color: colors.text }}>
                Potential duplicates
              </Text>
              {related.duplicates.map((duplicate) => (
                <View
                  key={String(duplicate.id)}
                  style={{
                    padding: spacing.md,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: radii.md,
                    backgroundColor: colors.surface,
                    gap: spacing.xs,
                  }}
                >
                  <Text style={{ ...type.label, color: colors.text }}>
                    {String(duplicate.fullName ?? duplicate.code)}
                  </Text>
                  <Text style={{ ...type.caption, color: colors.textMuted }}>
                    {String(duplicate.companyName ?? "No company")}
                  </Text>
                  <Pressable
                    disabled={busy}
                    onPress={() =>
                      Alert.alert(
                        "Merge lead?",
                        "The current lead will be archived and its history moved to this record.",
                        [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Merge",
                            style: "destructive",
                            onPress: () => void mergeLead(String(duplicate.id)),
                          },
                        ],
                      )
                    }
                  >
                    <Text style={{ ...type.label, color: colors.danger }}>
                      Merge into this lead
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          {message ? (
            <Text
              accessibilityRole="alert"
              style={{
                ...type.body,
                color:
                  message.includes("updated") || message.includes("completed")
                    ? colors.success
                    : colors.danger,
                marginBottom: spacing.md,
              }}
            >
              {message}
            </Text>
          ) : null}
          <View
            style={{
              borderRadius: radii.lg,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: "hidden",
            }}
          >
            {keys.map((key, index) => (
              <View
                key={key}
                style={{
                  padding: spacing.md,
                  borderTopWidth: index ? 1 : 0,
                  borderTopColor: colors.border,
                  gap: spacing.xxs,
                }}
              >
                <Text style={{ ...type.caption, color: colors.textMuted }}>
                  {label(key)}
                </Text>
                <Text selectable style={{ ...type.body, color: colors.text }}>
                  {value(record[key])}
                </Text>
              </View>
            ))}
          </View>
          {Object.entries(related)
            .filter(([section]) => section !== "duplicates")
            .map(([section, rows]) => (
              <View
                key={section}
                style={{ marginTop: spacing.xl, gap: spacing.sm }}
              >
                <Text
                  style={{
                    ...type.caption,
                    color: colors.primary,
                    textTransform: "uppercase",
                  }}
                >
                  {section.replace(/([A-Z])/g, " $1")}
                </Text>
                <Text style={{ ...type.heading, color: colors.text }}>
                  {section
                    .replace(/([A-Z])/g, " $1")
                    .replace(/^./, (letter) => letter.toUpperCase())}
                </Text>
                {rows.length ? (
                  rows.map((row, index) => {
                    const heading = String(
                      row.subject ??
                        row.name ??
                        row.item_name ??
                        row.reason ??
                        row.from_stage ??
                        row.channel ??
                        row.id ??
                        "Event",
                    );
                    const detail = String(
                      row.description ??
                        row.body ??
                        row.outcome ??
                        row.note ??
                        row.status ??
                        row.to_stage ??
                        "",
                    );
                    const time =
                      row.changed_at ??
                      row.occurred_at ??
                      row.completed_at ??
                      row.due_at ??
                      row.created_at;
                    return (
                      <View
                        key={String(row.id ?? index)}
                        style={{
                          padding: spacing.md,
                          borderRadius: radii.md,
                          backgroundColor: colors.surface,
                          borderWidth: 1,
                          borderColor: colors.border,
                          gap: spacing.xs,
                        }}
                      >
                        <Text style={{ ...type.label, color: colors.text }}>
                          {heading}
                        </Text>
                        {detail ? (
                          <Text
                            style={{
                              ...type.body,
                              color: colors.textSecondary,
                            }}
                          >
                            {detail}
                          </Text>
                        ) : null}
                        {time ? (
                          <Text
                            style={{ ...type.caption, color: colors.textMuted }}
                          >
                            {new Date(String(time)).toLocaleString()}
                          </Text>
                        ) : null}
                      </View>
                    );
                  })
                ) : (
                  <View
                    style={{
                      padding: spacing.lg,
                      borderRadius: radii.md,
                      backgroundColor: colors.surface,
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    <Text style={{ ...type.body, color: colors.textMuted }}>
                      No {section.replace(/([A-Z])/g, " $1").toLowerCase()}{" "}
                      recorded.
                    </Text>
                  </View>
                )}
              </View>
            ))}
          {query.isOfflineFallback ? (
            <Text
              style={{
                ...type.caption,
                color: colors.warning,
                marginTop: spacing.md,
              }}
            >
              Showing encrypted offline data
            </Text>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
