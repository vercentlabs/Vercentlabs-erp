import { Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { mobileApi } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { QueryState } from "@/ui/crm-states";
import { Screen } from "@/ui/screen";

export default function NotificationsScreen() {
  const { colors, radii, spacing, type } = useTheme();
  const query = useQuery({ queryKey: ["mobile-notifications"], queryFn: () => mobileApi.notifications() });
  async function readAll() { await mobileApi.markNotifications({ all: true }); await query.refetch(); }
  const rows = query.data?.notifications ?? [];
  return <Screen><View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.xl }}><Pressable accessibilityRole="button" onPress={() => router.back()}><Text style={{ ...type.label, color: colors.primary }}>Back</Text></Pressable><Text accessibilityRole="header" style={{ ...type.title, color: colors.text, flex: 1 }}>Notifications</Text>{rows.some((row) => !row.readAt) ? <Pressable accessibilityRole="button" onPress={() => void readAll()}><Text style={{ ...type.label, color: colors.primary }}>Read all</Text></Pressable> : null}</View>
    <QueryState loading={query.isLoading} error={query.error} empty={!rows.length} onRetry={() => void query.refetch()} />
    <View style={{ gap: spacing.sm }}>{rows.map((row) => <View key={row.id} style={{ padding: spacing.lg, borderRadius: radii.lg, backgroundColor: row.readAt ? colors.surface : colors.primarySoft, borderWidth: 1, borderColor: colors.border, gap: spacing.xs }}><Text style={{ ...type.label, color: colors.text }}>{row.title}</Text><Text style={{ ...type.body, color: colors.textSecondary }}>{row.message}</Text><Text style={{ ...type.caption, color: colors.textMuted }}>{new Date(row.createdAt).toLocaleString()}</Text></View>)}</View>
  </Screen>;
}
