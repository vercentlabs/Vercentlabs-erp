import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { useAuth } from "@/auth/auth-provider";
import { useTheme } from "@/theme/theme";
import { AppHeader } from "@/ui/app-header";
import { Screen } from "@/ui/screen";

export default function HomeScreen() {
  const auth = useAuth();
  const { colors, radii, spacing, type } = useTheme();
  const firstName = auth.session?.user.fullName.split(" ")[0] || "there";
  return (
    <Screen>
      <AppHeader eyebrow="Today" title={`Good to see you, ${firstName}`} />
      <View
        style={{
          padding: spacing.xl,
          borderRadius: radii.xl,
          backgroundColor: colors.navigation,
          gap: spacing.xl,
          overflow: "hidden",
        }}
      >
        <View style={{ gap: spacing.xs, maxWidth: 500 }}>
          <Text
            style={{
              ...type.caption,
              color: "#A5B4FC",
              textTransform: "uppercase",
            }}
          >
            Your sales cockpit
          </Text>
          <Text style={{ ...type.title, color: colors.inverse }}>
            Focus on the next best action.
          </Text>
          <Text style={{ ...type.body, color: "#B7C0D0" }}>
            Live pipeline signals, customer context and today&apos;s priorities
            will land here in the CRM experience.
          </Text>
        </View>
        <View
          style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}
        >
          {[
            ["flash-outline", "Fast actions"],
            ["cloud-offline-outline", "Offline ready"],
            ["shield-checkmark-outline", "Secure by default"],
          ].map(([icon, label]) => (
            <View
              key={label}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.xs,
                backgroundColor: "#172033",
                paddingHorizontal: spacing.sm,
                paddingVertical: spacing.xs,
                borderRadius: radii.full,
              }}
            >
              <Ionicons
                name={icon as keyof typeof Ionicons.glyphMap}
                size={16}
                color="#A5B4FC"
              />
              <Text style={{ ...type.caption, color: colors.inverse }}>
                {label}
              </Text>
            </View>
          ))}
        </View>
      </View>
      <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
        <Text style={{ ...type.heading, color: colors.text }}>
          Foundation status
        </Text>
        {[
          ["key-outline", "Device session", "Rotating, revocable access"],
          ["server-outline", "Mobile API", "Versioned public contract"],
          ["lock-closed-outline", "Offline vault", "Encrypted local workspace"],
        ].map(([icon, label, value]) => (
          <View
            key={label}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
              padding: spacing.md,
              borderRadius: radii.lg,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: radii.md,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.primarySoft,
              }}
            >
              <Ionicons
                name={icon as keyof typeof Ionicons.glyphMap}
                size={21}
                color={colors.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ ...type.label, color: colors.text }}>{label}</Text>
              <Text style={{ ...type.caption, color: colors.textMuted }}>
                {value}
              </Text>
            </View>
            <Ionicons
              name="checkmark-circle"
              size={22}
              color={colors.success}
            />
          </View>
        ))}
      </View>
    </Screen>
  );
}
