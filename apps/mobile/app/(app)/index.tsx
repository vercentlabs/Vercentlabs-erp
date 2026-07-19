import { Ionicons } from "@expo/vector-icons";
import { RefreshControl, Text, View } from "react-native";
import { mobileApi } from "@/api/client";
import { useAuth } from "@/auth/auth-provider";
import { useCrmQuery } from "@/data/use-crm-query";
import { useTheme } from "@/theme/theme";
import { AppHeader } from "@/ui/app-header";
import { QueryState } from "@/ui/crm-states";
import { Screen } from "@/ui/screen";

function number(value: unknown) { return Number(value ?? 0).toLocaleString("en-IN"); }

export default function HomeScreen() {
  const auth = useAuth();
  const { colors, radii, spacing, type } = useTheme();
  const query = useCrmQuery("dashboard", () => mobileApi.crmDashboard());
  const dashboard = query.data?.dashboard ?? {};
  const metrics = (dashboard.metrics ?? {}) as Record<string, unknown>;
  const firstName = auth.session?.user.fullName.split(" ")[0] || "there";
  const cards = [
    ["people-outline", "Open leads", metrics.openLeads ?? metrics.leadsOpen],
    ["trending-up-outline", "Open deals", metrics.openOpportunities ?? metrics.opportunitiesOpen],
    ["warning-outline", "Overdue", metrics.overdueActivities],
    ["checkmark-done-outline", "Won this month", metrics.wonThisMonth],
  ] as const;
  return <Screen refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />}>
    <AppHeader eyebrow="Today" title={`Good to see you, ${firstName}`} />
    <View style={{ padding: spacing.xl, borderRadius: radii.xl, backgroundColor: colors.navigation, gap: spacing.sm }}>
      <Text style={{ ...type.caption, color: "#A5B4FC", textTransform: "uppercase" }}>Your sales cockpit</Text>
      <Text style={{ ...type.title, color: colors.inverse }}>Focus on what moves revenue.</Text>
      <Text style={{ ...type.body, color: "#B7C0D0" }}>A live, permission-aware view of your customer work—securely cached for the moments your connection drops.</Text>
    </View>
    <QueryState loading={query.isLoading && !query.data} error={query.error} empty={false} onRetry={() => void query.refetch()} />
    {query.data ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.lg }}>
      {cards.map(([icon, label, value]) => <View key={label} style={{ width: "48%", minWidth: 145, flexGrow: 1, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.sm }}>
        <Ionicons name={icon} size={22} color={colors.primary} />
        <Text style={{ ...type.title, color: colors.text }}>{number(value)}</Text>
        <Text style={{ ...type.caption, color: colors.textMuted }}>{label}</Text>
      </View>)}
    </View> : null}
    {query.isOfflineFallback ? <Text style={{ ...type.caption, color: colors.warning, marginTop: spacing.md }}>Showing your encrypted offline copy</Text> : null}
  </Screen>;
}
