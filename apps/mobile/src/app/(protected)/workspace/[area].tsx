import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { mobileApi } from "@/core/api/client";
import { useAuth } from "@/core/auth/auth-provider";
import { AppHeader } from "@/shared/components/app-header";
import { QueryState } from "@/shared/components/crm-states";
import { ResourceCatalog } from "@/shared/components/resource-catalog";
import { Screen } from "@/shared/components/screen";
import { WorkspacePage } from "@/shared/components/workspace-page";
import { useTheme } from "@/shared/theme/theme";

const catalogCopy = {
  "crm-settings": {
    eyebrow: "CRM administration",
    title: "Configure the customer lifecycle",
    description: "Govern stages, engagement, intelligence, partner selling, analytics, privacy, data quality and integrations.",
  },
  "master-data": {
    eyebrow: "Business data foundation",
    title: "Govern the records every ERP module shares",
    description: "Maintain trusted partners, products, inventory locations and finance defaults.",
  },
  settings: {
    eyebrow: "Platform settings",
    title: "Configure the ERP foundation",
    description: "Maintain organisation structure, access controls and shared platform behaviour.",
  },
} as const;

export default function WorkspaceAreaScreen() {
  const { area: rawArea } = useLocalSearchParams<{ area: string }>();
  const area = rawArea || "";
  const auth = useAuth();
  const { colors, radii, spacing, type } = useTheme();
  const isCatalog = area === "crm-settings" || area === "master-data" || area === "settings";
  const catalog = useQuery({
    queryKey: ["mobile-catalog"],
    queryFn: () => mobileApi.catalog(),
    enabled: isCatalog,
  });

  if (!isCatalog) return <WorkspacePage area={area} />;

  const copy = catalogCopy[area];
  const definitions =
    area === "crm-settings"
      ? catalog.data?.catalog.crm
      : area === "master-data"
        ? catalog.data?.catalog.masterData
        : catalog.data?.catalog.settings;

  return (
    <Screen>
      <AppHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
      {area === "crm-settings" ? (
        <Pressable onPress={() => router.push("/(protected)/workspace/crm")} style={{ minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, marginBottom: spacing.xl, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, backgroundColor: colors.surface }}><Ionicons name="arrow-back" size={18} color={colors.textSecondary} /><Text style={{ ...type.label, color: colors.textSecondary }}>CRM overview</Text></Pressable>
      ) : null}
      {area === "master-data" ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.xl }}>
          {([[
            "Business partners", "parties", "people-outline"], ["Items and services", "items", "cube-outline"], ["Warehouses", "warehouses", "location-outline"], ["Enabled currencies", "currencies", "cash-outline"],
          ] as const).map(([label, key, icon]) => <View key={key} style={{ width: "47%", minWidth: 145, flexGrow: 1, minHeight: 112, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, gap: spacing.sm }}><Ionicons name={icon} size={21} color={colors.primary} /><Text style={{ ...type.heading, fontSize: 28, color: colors.text }}>{catalog.data?.catalog.masterDataOverview[key] || 0}</Text><Text style={{ ...type.caption, color: colors.textMuted }}>{label}</Text></View>)}
        </View>
      ) : null}
      {area === "settings" ? (
        <View style={{ gap: spacing.sm, marginBottom: spacing.xl }}>
          {([
            ["Users", "Invitations, status and operating access", "users.view", "/(protected)/workspace/users", "people-outline"],
            ["Roles & permissions", "Least-privilege roles and capabilities", "roles.manage", "/(protected)/workspace/roles", "key-outline"],
          ] as const).filter((item) => auth.session?.access.permissions.includes(item[2])).map(([label, description, , href, icon]) => <Pressable key={href} onPress={() => router.push(href)} style={{ minHeight: 82, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface }}><View style={{ width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: colors.primarySoft }}><Ionicons name={icon} size={21} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={{ ...type.label, color: colors.text }}>{label}</Text><Text style={{ ...type.caption, color: colors.textMuted }}>{description}</Text></View><Ionicons name="arrow-forward" size={18} color={colors.textMuted} /></Pressable>)}
        </View>
      ) : null}
      <QueryState
        loading={catalog.isLoading}
        error={catalog.error}
        empty={Boolean(catalog.data && !definitions?.length)}
        onRetry={() => void catalog.refetch()}
      />
      {definitions?.length ? (
        <ResourceCatalog area={area === "crm-settings" ? "crm" : area} definitions={definitions} />
      ) : null}
    </Screen>
  );
}
