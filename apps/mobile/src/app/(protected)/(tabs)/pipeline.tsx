import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { mobileApi } from "@/core/api/client";
import { useAuth } from "@/core/auth/auth-provider";
import { useCrmQuery } from "@/modules/crm/hooks/use-crm-query";
import { CreateRecordSheet } from "@/modules/crm/components/create-record-sheet";
import { AppHeader } from "@/shared/components/app-header";
import { QueryState, StatusPill } from "@/shared/components/crm-states";
import { Screen } from "@/shared/components/screen";
import { useTheme } from "@/shared/theme/theme";

export default function PipelineScreen() {
  const auth = useAuth();
  const { width } = useWindowDimensions();
  const { colors, radii, spacing, type } = useTheme();
  const opportunities = useCrmQuery("opportunities:pipeline", () =>
    mobileApi.listCrm("opportunities", { limit: 500, status: "all" }),
  );
  const stages = useCrmQuery("pipeline-stages:board", () =>
    mobileApi.listCrm("stages", { limit: 100, status: "active" }),
  );
  const rows = opportunities.data?.rows ?? [];
  const columns = stages.data?.rows ?? [];
  const columnWidth = Math.min(380, Math.max(280, width * 0.84));
  const canManage = Boolean(
    auth.session?.access.permissions.includes("crm.opportunities.manage"),
  );
  const currency = String(
    rows.find((row) => row.currencyCode)?.currencyCode || "INR",
  );
  const money = (value: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);

  return (
    <Screen
      refreshControl={
        <RefreshControl
          refreshing={opportunities.isFetching || stages.isFetching}
          onRefresh={() =>
            void Promise.all([opportunities.refetch(), stages.refetch()])
          }
          tintColor={colors.primary}
        />
      }
    >
      <AppHeader
        eyebrow="Revenue pipeline"
        title="Opportunity Kanban"
        description="Move qualified revenue through governed stages, probability and forecasting."
      />
      {canManage ? <CreateRecordSheet resource="opportunities" /> : null}
      <QueryState
        loading={(opportunities.isLoading || stages.isLoading) && !rows.length}
        error={opportunities.error || stages.error}
        empty={!columns.length}
        onRetry={() =>
          void Promise.all([opportunities.refetch(), stages.refetch()])
        }
      />
      {columns.length ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.md }}
        >
          {columns.map((stage) => {
            const stageRows = rows.filter((row) => row.stageId === stage.id);
            const total = stageRows.reduce(
              (sum, row) => sum + Number(row.amount || 0),
              0,
            );
            return (
              <View
                key={String(stage.id)}
                style={{
                  width: columnWidth,
                  padding: spacing.sm,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: radii.md,
                  backgroundColor: colors.canvas,
                  gap: spacing.sm,
                }}
              >
                <View style={{ padding: spacing.xs, gap: 3 }}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <Text
                      style={{ ...type.label, flex: 1, color: colors.text }}
                    >
                      {String(stage.name)}
                    </Text>
                    <StatusPill value={String(stageRows.length)} />
                  </View>
                  <Text style={{ ...type.caption, color: colors.textMuted }}>
                    {money(total)} · {String(stage.probability || 0)}%
                    probability
                  </Text>
                </View>
                {stageRows.map((row) => (
                  <Pressable
                    key={String(row.id)}
                    onPress={() =>
                      router.push({
                        pathname: "/(protected)/crm/[resource]/[id]",
                        params: {
                          resource: "opportunities",
                          id: String(row.id),
                        },
                      })
                    }
                    style={{
                      minHeight: 132,
                      padding: spacing.md,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: radii.md,
                      backgroundColor: colors.surface,
                      gap: spacing.sm,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "flex-start",
                        gap: spacing.sm,
                      }}
                    >
                      <View
                        style={{
                          width: 38,
                          height: 38,
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: 11,
                          backgroundColor: colors.primarySoft,
                        }}
                      >
                        <Ionicons
                          name="trending-up-outline"
                          size={20}
                          color={colors.primary}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          numberOfLines={2}
                          style={{ ...type.label, color: colors.text }}
                        >
                          {String(row.name || row.code)}
                        </Text>
                        <Text
                          style={{ ...type.caption, color: colors.textMuted }}
                        >
                          {String(row.code || "Opportunity")}
                        </Text>
                      </View>
                    </View>
                    <Text style={{ ...type.heading, color: colors.text }}>
                      {money(Number(row.amount || 0))}
                    </Text>
                    <Text style={{ ...type.caption, color: colors.textMuted }}>
                      Expected close ·{" "}
                      {String(row.expectedCloseDate || "Not set")}
                    </Text>
                  </Pressable>
                ))}
                {!stageRows.length ? (
                  <View
                    style={{
                      minHeight: 112,
                      alignItems: "center",
                      justifyContent: "center",
                      padding: spacing.md,
                      borderWidth: 1,
                      borderStyle: "dashed",
                      borderColor: colors.border,
                      borderRadius: radii.md,
                    }}
                  >
                    <Text style={{ ...type.caption, color: colors.textMuted }}>
                      No opportunities in this stage
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      ) : null}
    </Screen>
  );
}
