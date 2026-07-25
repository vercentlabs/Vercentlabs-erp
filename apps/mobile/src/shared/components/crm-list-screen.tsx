import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import * as Crypto from "expo-crypto";
import { router } from "expo-router";
import { mobileApi } from "@/core/api/client";
import { useCrmQuery } from "@/modules/crm/hooks/use-crm-query";
import { enqueueMutation } from "@/core/database/database";
import { useTheme } from "@/shared/theme/theme";
import { AppHeader } from "./app-header";
import { QueryState, StatusPill } from "./crm-states";
import { Screen } from "./screen";

type Resource = "leads" | "opportunities" | "activities";
const text = (row: Record<string, unknown>, keys: string[]) =>
  keys
    .map((key) => row[key])
    .find((value) => typeof value === "string" && value) as string | undefined;
const money = (value: unknown, currency = "INR") =>
  typeof value === "number" || typeof value === "string"
    ? new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(Number(value))
    : null;

export function CrmListScreen({
  resource,
  eyebrow,
  title,
  titleKeys,
  subtitleKeys,
  icon,
  headerAction,
  canManage = false,
}: {
  resource: Resource;
  eyebrow: string;
  title: string;
  titleKeys: string[];
  subtitleKeys: string[];
  icon: keyof typeof Ionicons.glyphMap;
  headerAction?: ReactNode;
  canManage?: boolean;
}) {
  const { colors, radii, spacing, type } = useTheme();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const query = useCrmQuery(`${resource}:recent`, () =>
    mobileApi.listCrm(resource, { limit: 100 }),
  );
  const rows = useMemo(() => query.data?.rows ?? [], [query.data?.rows]);
  const statuses = useMemo(
    () =>
      [
        "all",
        ...Array.from(
          new Set(
            rows.map((row) => String(row.status ?? row.priority ?? "active")),
          ),
        ),
      ].slice(0, 6),
    [rows],
  );
  const visible = useMemo(
    () =>
      rows.filter((row) => {
        const haystack = JSON.stringify(row).toLowerCase();
        const matchesSearch =
          !search.trim() || haystack.includes(search.trim().toLowerCase());
        const rowStatus = String(row.status ?? row.priority ?? "active");
        return matchesSearch && (status === "all" || rowStatus === status);
      }),
    [rows, search, status],
  );
  async function complete(row: Record<string, unknown>) {
    const id = String(row.id);
    const idempotencyKey = Crypto.randomUUID();
    try {
      await mobileApi.completeActivity(id, undefined, idempotencyKey);
      await query.refetch();
    } catch (error) {
      if ((error as { retryable?: boolean }).retryable !== false) {
        await enqueueMutation({
          id: Crypto.randomUUID(),
          operation: "complete",
          resource: "activities",
          recordId: id,
          payload: {},
          idempotencyKey,
        });
      }
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
      <AppHeader eyebrow={eyebrow} title={title} />
      {headerAction}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          minHeight: 52,
          paddingHorizontal: spacing.md,
          borderRadius: radii.md,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          marginBottom: spacing.md,
        }}
      >
        <Ionicons name="search-outline" size={20} color={colors.textMuted} />
        <TextInput
          accessibilityLabel={`Search ${title}`}
          value={search}
          onChangeText={setSearch}
          placeholder={`Search ${title.toLowerCase()}`}
          placeholderTextColor={colors.textMuted}
          style={{ flex: 1, ...type.body, color: colors.text }}
        />
        {search ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => setSearch("")}
          >
            <Ionicons name="close-circle" size={21} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {statuses.length > 2 ? (
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: spacing.xs,
            marginBottom: spacing.md,
          }}
        >
          {statuses.map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: status === value }}
              onPress={() => setStatus(value)}
              style={{
                minHeight: 40,
                justifyContent: "center",
                paddingHorizontal: spacing.md,
                borderRadius: radii.full,
                backgroundColor:
                  status === value ? colors.navigation : colors.surface,
                borderWidth: 1,
                borderColor:
                  status === value ? colors.navigation : colors.border,
              }}
            >
              <Text
                style={{
                  ...type.caption,
                  color:
                    status === value ? colors.inverse : colors.textSecondary,
                  textTransform: "capitalize",
                }}
              >
                {value}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {rows.length ? (
        <Text
          style={{
            ...type.caption,
            color: colors.textMuted,
            marginBottom: spacing.md,
          }}
        >
          {visible.length} of {query.data?.total ?? rows.length} records
        </Text>
      ) : null}
      {query.isOfflineFallback ? (
        <Text
          style={{
            ...type.caption,
            color: colors.warning,
            marginBottom: spacing.md,
          }}
        >
          Offline copy · reconnect to refresh
        </Text>
      ) : null}
      <QueryState
        loading={query.isLoading && !query.data}
        error={query.error}
        empty={!visible.length}
        onRetry={() => void query.refetch()}
      />
      <View style={{ gap: spacing.sm }}>
        {visible.map((row, index) => {
          const id = String(row.id ?? index);
          const status = String(row.status ?? row.priority ?? "active");
          return (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={`Open ${title} record`}
              onPress={() =>
                router.push({
                  pathname: "/(protected)/crm/[resource]/[id]",
                  params: { resource, id },
                })
              }
              style={{
                padding: spacing.lg,
                borderRadius: radii.lg,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                gap: spacing.sm,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  gap: spacing.md,
                  alignItems: "center",
                }}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: radii.md,
                    backgroundColor: colors.primarySoft,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name={icon} size={21} color={colors.primary} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text
                    numberOfLines={1}
                    style={{ ...type.label, color: colors.text }}
                  >
                    {text(row, titleKeys) ?? "Untitled record"}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={{ ...type.caption, color: colors.textMuted }}
                  >
                    {text(row, subtitleKeys) ?? String(row.code ?? "CRM")}
                  </Text>
                </View>
                <StatusPill value={status} />
              </View>
              {money(
                row.amount ?? row.estimatedValue,
                String(row.currencyCode ?? "INR"),
              ) ? (
                <Text style={{ ...type.heading, color: colors.text }}>
                  {money(
                    row.amount ?? row.estimatedValue,
                    String(row.currencyCode ?? "INR"),
                  )}
                </Text>
              ) : null}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text style={{ ...type.caption, color: colors.primary }}>
                  View full record
                </Text>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.primary}
                />
              </View>
              {canManage &&
              resource === "activities" &&
              status !== "completed" ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={(event) => {
                    event.stopPropagation();
                    void complete(row);
                  }}
                  style={{
                    minHeight: 48,
                    justifyContent: "center",
                    alignItems: "center",
                    borderRadius: radii.full,
                    backgroundColor: colors.primarySoft,
                  }}
                >
                  <Text style={{ ...type.label, color: colors.primary }}>
                    Mark complete
                  </Text>
                </Pressable>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}
