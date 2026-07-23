import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { useAuth } from "@/core/auth/auth-provider";
import { administrationNavigation, visibleDestinations, workspaceNavigation, type WorkspaceDestination } from "@/core/modules/navigation";
import { useTheme } from "@/shared/theme/theme";
import { AppHeader } from "@/shared/components/app-header";
import { Button } from "@/shared/components/button";
import { Screen } from "@/shared/components/screen";

export default function MoreScreen() {
  const auth = useAuth();
  const { colors, radii, spacing, type } = useTheme();
  if (!auth.session) return null;
  const permissions = auth.session.access.permissions ?? [];
  const renderDestination = (item: WorkspaceDestination) => (
    <Pressable
      key={item.key}
      accessibilityRole="button"
      accessibilityLabel={item.label}
      onPress={() => router.push(item.href)}
      style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}
    >
      <Ionicons name={item.icon} size={22} color={colors.primary} />
      <Text style={{ ...type.label, color: colors.text, flex: 1 }}>{item.label}</Text>
      <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
    </Pressable>
  );
  return (
    <Screen>
      <AppHeader eyebrow="Workspace" title="More" />
      <View
        style={{
          padding: spacing.xl,
          borderRadius: radii.xl,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          gap: spacing.lg,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.md,
          }}
        >
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: colors.primarySoft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ ...type.heading, color: colors.primary }}>
              {auth.session.user.fullName.slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ ...type.heading, color: colors.text }}>
              {auth.session.user.fullName}
            </Text>
            <Text style={{ ...type.caption, color: colors.textMuted }}>
              {auth.session.user.email}
            </Text>
          </View>
          <Ionicons name="shield-checkmark" size={23} color={colors.success} />
        </View>
        <View
          style={{
            padding: spacing.md,
            borderRadius: radii.md,
            backgroundColor: colors.primarySoft,
            gap: spacing.xs,
          }}
        >
          <Text style={{ ...type.caption, color: colors.primary }}>
            ACTIVE CONTEXT
          </Text>
          <Text style={{ ...type.label, color: colors.text }}>
            {auth.session.workspace.organizationName ||
              "Workspace setup required"}
          </Text>
          <Text style={{ ...type.caption, color: colors.textMuted }}>
            {[
              auth.session.workspace.companyName,
              auth.session.workspace.branchName,
            ]
              .filter(Boolean)
              .join(" · ") || "Complete onboarding on the web application."}
          </Text>
        </View>
        <Button label="Sign out" variant="secondary" onPress={auth.signOut} />
      </View>
      <View style={{ height: spacing.xl }} />
      <View style={{ borderRadius: radii.xl, overflow: "hidden", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
        <View style={{ padding: spacing.lg }}><Text style={{ ...type.heading, color: colors.text }}>Workspace</Text><Text style={{ ...type.caption, color: colors.textMuted }}>Matches the web sidebar for your access level</Text></View>
        {visibleDestinations(workspaceNavigation, permissions).map(renderDestination)}
      </View>
      {visibleDestinations(administrationNavigation, permissions).length ? <>
        <View style={{ height: spacing.xl }} />
        <View style={{ borderRadius: radii.xl, overflow: "hidden", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
          <View style={{ padding: spacing.lg }}><Text style={{ ...type.heading, color: colors.text }}>Administration</Text><Text style={{ ...type.caption, color: colors.textMuted }}>Native, permission-scoped workspace administration</Text></View>
          {visibleDestinations(administrationNavigation, permissions).map(renderDestination)}
        </View>
      </> : null}
      <View style={{ height: spacing.xl }} />
      <View style={{ padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.primarySoft, gap: spacing.xs }}>
        <Text style={{ ...type.label, color: colors.primary }}>Security & profile</Text>
        <Text style={{ ...type.body, color: colors.textSecondary }}>Device-bound session protection, encrypted offline storage, identity details and secure sign-out are active in this app.</Text>
      </View>
    </Screen>
  );
}
