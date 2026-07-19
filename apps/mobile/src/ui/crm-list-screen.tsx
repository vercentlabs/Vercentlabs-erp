import { Ionicons } from "@expo/vector-icons";
import { RefreshControl, Text, View } from "react-native";
import { mobileApi } from "@/api/client";
import { useCrmQuery } from "@/data/use-crm-query";
import { useTheme } from "@/theme/theme";
import { AppHeader } from "./app-header";
import { QueryState, StatusPill } from "./crm-states";
import { Screen } from "./screen";

type Resource = "leads" | "opportunities" | "activities";
const text = (row: Record<string, unknown>, keys: string[]) => keys.map((key) => row[key]).find((value) => typeof value === "string" && value) as string | undefined;
const money = (value: unknown, currency = "INR") => typeof value === "number" || typeof value === "string" ? new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value)) : null;

export function CrmListScreen({ resource, eyebrow, title, titleKeys, subtitleKeys, icon }: { resource: Resource; eyebrow: string; title: string; titleKeys: string[]; subtitleKeys: string[]; icon: keyof typeof Ionicons.glyphMap }) {
  const { colors, radii, spacing, type } = useTheme();
  const query = useCrmQuery(`${resource}:recent`, () => mobileApi.listCrm(resource, { limit: 50 }));
  const rows = query.data?.rows ?? [];
  return <Screen refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} tintColor={colors.primary} />}>
    <AppHeader eyebrow={eyebrow} title={title} />
    {query.isOfflineFallback ? <Text style={{ ...type.caption, color: colors.warning, marginBottom: spacing.md }}>Offline copy · reconnect to refresh</Text> : null}
    <QueryState loading={query.isLoading && !query.data} error={query.error} empty={!rows.length} onRetry={() => void query.refetch()} />
    <View style={{ gap: spacing.sm }}>
      {rows.map((row, index) => {
        const id = String(row.id ?? index);
        const status = String(row.status ?? row.priority ?? "active");
        return <View key={id} accessibilityLabel={`${title} record`} style={{ padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.sm }}>
          <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
            <View style={{ width: 44, height: 44, borderRadius: radii.md, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" }}><Ionicons name={icon} size={21} color={colors.primary} /></View>
            <View style={{ flex: 1, gap: 2 }}><Text numberOfLines={1} style={{ ...type.label, color: colors.text }}>{text(row, titleKeys) ?? "Untitled record"}</Text><Text numberOfLines={1} style={{ ...type.caption, color: colors.textMuted }}>{text(row, subtitleKeys) ?? String(row.code ?? "CRM")}</Text></View>
            <StatusPill value={status} />
          </View>
          {money(row.amount ?? row.estimatedValue, String(row.currencyCode ?? "INR")) ? <Text style={{ ...type.heading, color: colors.text }}>{money(row.amount ?? row.estimatedValue, String(row.currencyCode ?? "INR"))}</Text> : null}
        </View>;
      })}
    </View>
  </Screen>;
}
