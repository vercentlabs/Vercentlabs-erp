import { Pressable, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, type Href } from "expo-router";

import { mobileApi } from "@/core/api/client";
import { AppHeader } from "@/shared/components/app-header";
import { QueryState } from "@/shared/components/crm-states";
import { Screen } from "@/shared/components/screen";
import { useTheme } from "@/shared/theme/theme";

function nativeHref(href: string | null): Href | null {
  if (!href) return null;
  if (href === "/dashboard") return "/(protected)/(tabs)";
  if (href === "/approvals") return "/(protected)/workspace/approvals";
  if (href === "/profile") return "/(protected)/workspace/profile";
  if (href === "/security") return "/(protected)/workspace/security";
  if (href === "/billing") return "/(protected)/workspace/billing";
  if (href.startsWith("/crm/")) {
    const [, , resource, id] = href.split("/");
    if (!resource) return null;
    return id
      ? { pathname: "/(protected)/crm/[resource]/[id]", params: { resource, id } }
      : { pathname: "/(protected)/workspace/[area]/[resource]", params: { area: "crm", resource } };
  }
  return null;
}

export default function NotificationsScreen() {
  const queryClient = useQueryClient();
  const { colors, radii, spacing, type } = useTheme();
  const query = useQuery({ queryKey: ["mobile-notifications"], queryFn: () => mobileApi.notifications() });
  const refreshShell = () => queryClient.invalidateQueries({ queryKey: ["workspace-shell"] });
  async function readAll() {
    await mobileApi.markNotifications({ all: true });
    await Promise.all([query.refetch(), refreshShell()]);
  }
  async function open(id: string, href: string | null) {
    await mobileApi.markNotifications({ id });
    await refreshShell();
    const target = nativeHref(href);
    if (target) router.push(target);
    else await query.refetch();
  }
  const rows = query.data?.notifications ?? [];
  return (
    <Screen>
      <AppHeader eyebrow="Workspace updates" title="Notifications" description="Review role-scoped alerts, approvals and platform events." />
      {rows.some((row) => !row.readAt) ? (
        <Pressable accessibilityRole="button" onPress={() => void readAll()} style={{ alignSelf: "flex-end", marginBottom: spacing.md }}><Text style={{ ...type.label, color: colors.primary }}>Mark all as read</Text></Pressable>
      ) : null}
      <QueryState loading={query.isLoading} error={query.error} empty={!rows.length} onRetry={() => void query.refetch()} />
      <View style={{ gap: spacing.sm }}>
        {rows.map((row) => (
          <Pressable key={row.id} accessibilityRole="button" onPress={() => void open(row.id, row.href)} style={{ minHeight: 104, padding: spacing.md, borderRadius: radii.md, backgroundColor: row.readAt ? colors.surface : colors.primarySoft, borderWidth: 1, borderColor: row.readAt ? colors.border : "#C7D2FE", gap: spacing.xs }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}><Text style={{ ...type.label, flex: 1, color: colors.text }}>{row.title}</Text>{!row.readAt ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }} /> : null}</View>
            <Text style={{ ...type.body, color: colors.textSecondary }}>{row.message}</Text>
            <Text style={{ ...type.caption, color: colors.textMuted }}>{new Date(row.createdAt).toLocaleString()}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
