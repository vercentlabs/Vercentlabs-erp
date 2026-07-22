import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, RefreshControl, Text, View } from "react-native";
import { mobileApi } from "@/core/api/client";
import { useAuth } from "@/core/auth/auth-provider";
import { useCrmQuery } from "@/modules/crm/hooks/use-crm-query";
import { useTheme } from "@/shared/theme/theme";
import { AppHeader } from "@/shared/components/app-header";
import { QueryState, StatusPill } from "@/shared/components/crm-states";
import { Screen } from "@/shared/components/screen";
import { Section } from "@/shared/components/section";

const count = (value: unknown) => Number(value ?? 0).toLocaleString("en-IN");
const money = (value: unknown, currency: string) => new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value ?? 0));

export default function HomeScreen() {
  const auth = useAuth(); const { colors, radii, spacing, type } = useTheme();
  const query = useCrmQuery("dashboard", () => mobileApi.crmDashboard());
  const dashboard = query.data?.dashboard ?? {}; const metrics = (dashboard.metrics ?? {}) as Record<string, unknown>;
  const stages = (dashboard.stages ?? []) as Record<string, unknown>[]; const sources = (dashboard.sources ?? []) as Record<string, unknown>[]; const activities = (dashboard.activities ?? []) as Record<string, unknown>[];
  const currency = String(metrics.currencyCode ?? "INR"); const firstName = auth.session?.user.fullName.split(" ")[0] || "there";
  const cards = [
    ["people-outline", "Open leads", count(metrics.openLeads)], ["trending-up-outline", "Open deals", count(metrics.openOpportunities)],
    ["cash-outline", "Pipeline", money(metrics.pipelineValue, currency)], ["analytics-outline", "Weighted", money(metrics.weightedPipeline, currency)],
    ["warning-outline", "Overdue", count(metrics.overdueActivities)], ["today-outline", "Due today", count(metrics.dueToday)],
    ["flame-outline", "Qualified", count(metrics.qualifiedLeads)], ["swap-horizontal-outline", "Conversions", count(metrics.conversionsThisMonth)],
  ] as const;
  return <Screen refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />}>
    <AppHeader eyebrow="Today" title={`Welcome back, ${firstName}`} />
    <View style={{ padding: spacing.xl, borderRadius: radii.xl, backgroundColor: colors.navigation, gap: spacing.md }}><Text style={{ ...type.caption, color: "#A5B4FC", textTransform: "uppercase" }}>ERP workspace</Text><Text style={{ ...type.title, color: colors.inverse }}>Move the right work forward.</Text><Text style={{ ...type.body, color: "#D0D5DD" }}>{auth.session?.workspace.organizationName} · {[auth.session?.workspace.companyName, auth.session?.workspace.branchName].filter(Boolean).join(" · ") || "All available records"}</Text><View style={{ flexDirection: "row", gap: spacing.sm }}><Pressable onPress={() => router.push("/(protected)/(tabs)/leads")} style={{ flex: 1, minHeight: 48, justifyContent: "center", alignItems: "center", borderRadius: radii.full, backgroundColor: colors.primary }}><Text style={{ ...type.label, color: colors.inverse }}>Open CRM</Text></Pressable><Pressable onPress={() => router.push("/(protected)/(tabs)/modules")} style={{ flex: 1, minHeight: 48, justifyContent: "center", alignItems: "center", borderRadius: radii.full, borderWidth: 1, borderColor: "#667085" }}><Text style={{ ...type.label, color: colors.inverse }}>Modules</Text></Pressable></View></View>
    <QueryState loading={query.isLoading && !query.data} error={query.error} empty={false} onRetry={() => void query.refetch()} />
    {query.data ? <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginVertical: spacing.xl }}>{cards.map(([icon, label, value]) => <View key={label} style={{ width: "47%", minWidth: 145, flexGrow: 1, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.sm }}><Ionicons name={icon} size={22} color={colors.primary} /><Text numberOfLines={1} adjustsFontSizeToFit style={{ ...type.heading, color: colors.text }}>{value}</Text><Text style={{ ...type.caption, color: colors.textMuted }}>{label}</Text></View>)}</View>
      <Section title="Pipeline snapshot" detail="Live value and deal count by stage"><View style={{ gap: spacing.sm }}>{stages.map((stage) => { const total = Math.max(1, Number(metrics.pipelineValue ?? 0)); const width = `${Math.max(4, Math.min(100, Number(stage.amount ?? 0) / total * 100))}%` as `${number}%`; return <Pressable key={String(stage.id)} onPress={() => router.push("/(protected)/(tabs)/pipeline")} style={{ padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.xs }}><View style={{ flexDirection: "row", justifyContent: "space-between" }}><Text style={{ ...type.label, color: colors.text }}>{String(stage.name)}</Text><Text style={{ ...type.caption, color: colors.textMuted }}>{count(stage.opportunityCount)} deals · {money(stage.amount, currency)}</Text></View><View style={{ height: 7, borderRadius: 4, backgroundColor: colors.primarySoft }}><View style={{ width, height: 7, borderRadius: 4, backgroundColor: colors.primary }} /></View></Pressable>; })}</View></Section>
      <View style={{ height: spacing.xl }} /><Section title="Upcoming activities" detail="Your next customer commitments"><View style={{ gap: spacing.sm }}>{activities.length ? activities.slice(0, 5).map((activity) => <Pressable key={String(activity.id)} onPress={() => router.push({ pathname: "/(protected)/crm/[resource]/[id]", params: { resource: "activities", id: String(activity.id) } })} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}><Ionicons name="checkmark-circle-outline" size={22} color={colors.primary} /><View style={{ flex: 1 }}><Text numberOfLines={1} style={{ ...type.label, color: colors.text }}>{String(activity.subject ?? activity.title ?? "Activity")}</Text><Text numberOfLines={1} style={{ ...type.caption, color: colors.textMuted }}>{String(activity.dueAt ?? activity.activityType ?? "No due date")}</Text></View><StatusPill value={String(activity.status ?? "open")} /></Pressable>) : <Text style={{ ...type.body, color: colors.textMuted }}>No upcoming activities.</Text>}</View></Section>
      <View style={{ height: spacing.xl }} /><Section title="Lead sources" detail="Acquisition and conversion performance"><View style={{ gap: spacing.sm }}>{sources.slice(0, 6).map((source) => <View key={String(source.name)} style={{ flexDirection: "row", alignItems: "center", padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}><View style={{ flex: 1 }}><Text style={{ ...type.label, color: colors.text }}>{String(source.name)}</Text><Text style={{ ...type.caption, color: colors.textMuted }}>{count(source.convertedCount)} converted</Text></View><Text style={{ ...type.heading, color: colors.primary }}>{count(source.leadCount)}</Text></View>)}</View></Section>
    </> : null}
    {query.isOfflineFallback ? <Text style={{ ...type.caption, color: colors.warning, marginTop: spacing.md }}>Showing your encrypted offline copy</Text> : null}
  </Screen>;
}
