import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { useAuth } from "@/auth/auth-provider";
import { useTheme } from "@/theme/theme";
import { AppHeader } from "@/ui/app-header";
import { Button } from "@/ui/button";
import { Screen } from "@/ui/screen";

export default function MoreScreen() {
  const auth = useAuth();
  const { colors, radii, spacing, type } = useTheme();
  if (!auth.session) return null;
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
    </Screen>
  );
}
