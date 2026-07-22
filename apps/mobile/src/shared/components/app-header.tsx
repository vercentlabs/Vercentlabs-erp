import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";

import { useAuth } from "@/core/auth/auth-provider";
import { useTheme } from "@/shared/theme/theme";
import { minimumTouchTarget } from "@/shared/theme/tokens";
import { BrandMark } from "./brand-mark";

export function AppHeader({
  eyebrow,
  title,
}: {
  eyebrow?: string;
  title: string;
}) {
  const auth = useAuth();
  const { colors, spacing, type } = useTheme();
  const workspace = auth.session?.workspace;
  return (
    <View style={{ gap: spacing.lg, marginBottom: spacing.xl }}>
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}
      >
        <BrandMark size={40} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ ...type.label, color: colors.text }}>
            {workspace?.organizationName || "Vercent ERP"}
          </Text>
          <Text
            numberOfLines={1}
            style={{ ...type.caption, color: colors.textMuted }}
          >
            {[workspace?.companyName, workspace?.branchName]
              .filter(Boolean)
              .join(" · ") || "Secure mobile workspace"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search"
          onPress={() => router.push("/(protected)/search")}
          style={{
            width: minimumTouchTarget,
            height: minimumTouchTarget,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 24,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Ionicons
            name="search-outline"
            size={22}
            color={colors.textSecondary}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Notifications"
          onPress={() => router.push("/(protected)/notifications")}
          style={{
            width: minimumTouchTarget,
            height: minimumTouchTarget,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 24,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Ionicons
            name="notifications-outline"
            size={22}
            color={colors.textSecondary}
          />
        </Pressable>
      </View>
      <View style={{ gap: spacing.xs }}>
        {eyebrow ? (
          <Text
            style={{
              ...type.caption,
              color: colors.primary,
              textTransform: "uppercase",
            }}
          >
            {eyebrow}
          </Text>
        ) : null}
        <Text
          accessibilityRole="header"
          style={{ ...type.title, color: colors.text }}
        >
          {title}
        </Text>
      </View>
    </View>
  );
}
