import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useTheme } from "@/theme/theme";

export function QueryState({ loading, error, empty, onRetry }: { loading: boolean; error: unknown; empty: boolean; onRetry(): void }) {
  const { colors, radii, spacing, type } = useTheme();
  if (loading) return <View style={{ padding: spacing.hero, alignItems: "center", gap: spacing.md }}><ActivityIndicator color={colors.primary} /><Text style={{ ...type.body, color: colors.textMuted }}>Loading your workspace…</Text></View>;
  if (!error && !empty) return null;
  return <View style={{ padding: spacing.xl, borderRadius: radii.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", gap: spacing.sm }}>
    <Ionicons name={error ? "cloud-offline-outline" : "sparkles-outline"} size={30} color={colors.primary} />
    <Text style={{ ...type.heading, color: colors.text }}>{error ? "Couldn’t refresh" : "You’re all caught up"}</Text>
    <Text style={{ ...type.body, color: colors.textMuted, textAlign: "center" }}>{error ? "Cached information remains available. Check your connection and try again." : "New CRM records will appear here."}</Text>
    {error ? <Pressable accessibilityRole="button" onPress={onRetry} style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: spacing.lg, borderRadius: radii.full, backgroundColor: colors.primary }}><Text style={{ ...type.label, color: colors.inverse }}>Try again</Text></Pressable> : null}
  </View>;
}

export function StatusPill({ value }: { value: string }) {
  const { colors, radii, spacing, type } = useTheme();
  return <View style={{ paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radii.full, backgroundColor: colors.primarySoft }}><Text style={{ ...type.caption, color: colors.primary, textTransform: "capitalize" }}>{value.replaceAll("_", " ")}</Text></View>;
}
