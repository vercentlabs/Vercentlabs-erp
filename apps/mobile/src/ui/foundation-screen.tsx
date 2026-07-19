import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { useTheme } from "@/theme/theme";
import { AppHeader } from "./app-header";
import { Screen } from "./screen";

export function FoundationScreen({
  title,
  description,
  icon,
}: {
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  const { colors, radii, spacing, type } = useTheme();
  return (
    <Screen>
      <AppHeader title={title} eyebrow="CRM workspace" />
      <View
        style={{
          borderRadius: radii.xl,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          padding: spacing.xl,
          gap: spacing.lg,
        }}
      >
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: radii.md,
            backgroundColor: colors.primarySoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name={icon} size={26} color={colors.primary} />
        </View>
        <View style={{ gap: spacing.xs }}>
          <Text style={{ ...type.heading, color: colors.text }}>
            Secure foundation connected
          </Text>
          <Text style={{ ...type.body, color: colors.textMuted }}>
            {description}
          </Text>
        </View>
        <View
          style={{
            flexDirection: "row",
            gap: spacing.sm,
            padding: spacing.md,
            borderRadius: radii.md,
            backgroundColor: colors.successSoft,
          }}
        >
          <Ionicons
            name="shield-checkmark-outline"
            size={21}
            color={colors.success}
          />
          <Text style={{ ...type.caption, color: colors.success, flex: 1 }}>
            Your device session and offline workspace are encrypted and ready
            for CRM data.
          </Text>
        </View>
      </View>
    </Screen>
  );
}
