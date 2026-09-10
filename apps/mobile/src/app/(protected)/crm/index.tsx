import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Linking, Pressable, Text, View } from "react-native";

import { appConfig } from "@/core/config";
import { CRM_MOBILE_FEATURES } from "@/modules/crm/ui/crm-feature-registry";
import { AppHeader } from "@/shared/components/app-header";
import { Screen } from "@/shared/components/screen";
import { useTheme } from "@/shared/theme/theme";

const groups = ["Customers", "Pipeline", "Work", "Engagement", "Insights", "Data", "Setup"] as const;

function supportLabel(value: (typeof CRM_MOBILE_FEATURES)[number]["support"]) {
  if (value === "native") return "Native";
  if (value === "native-action") return "Native action";
  if (value === "native-read") return "Native view";
  return "Web workspace";
}

export default function CrmHomeScreen() {
  const { colors, radii, spacing, type } = useTheme();

  return (
    <Screen>
      <AppHeader
        eyebrow="Customer relationships"
        title="CRM"
        description="Every CRM capability has a visible destination. Daily work stays native; configuration and deep analysis open the governed web workspace when needed."
      />
      <View style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.xl }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(protected)/(tabs)/leads")}
          style={{ flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.md, backgroundColor: colors.primary }}
        >
          <Text style={{ ...type.label, color: colors.inverse }}>Leads</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(protected)/(tabs)/pipeline")}
          style={{ flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}
        >
          <Text style={{ ...type.label, color: colors.text }}>Pipeline</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(protected)/(tabs)/activities")}
          style={{ flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}
        >
          <Text style={{ ...type.label, color: colors.text }}>Work</Text>
        </Pressable>
      </View>

      {groups.map((group) => {
        const features = CRM_MOBILE_FEATURES.filter((feature) => feature.group === group);
        return (
          <View key={group} style={{ gap: spacing.sm, marginBottom: spacing.xl }}>
            <Text accessibilityRole="header" style={{ ...type.heading, color: colors.text }}>{group}</Text>
            {features.map((feature) => (
              <Pressable
                key={feature.id}
                accessibilityRole="button"
                accessibilityHint={feature.support === "web-workspace" ? "Opens this CRM capability in the web workspace" : undefined}
                onPress={() => {
                  if (feature.nativeHref) router.push(feature.nativeHref);
                  else void Linking.openURL(`${appConfig.webAppUrl}${feature.webPath}`);
                }}
                style={{ minHeight: 82, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, backgroundColor: colors.surface }}
              >
                <View style={{ width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: radii.md, backgroundColor: colors.primarySoft }}>
                  <Ionicons name={feature.support === "web-workspace" ? "open-outline" : "checkmark-circle-outline"} size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ ...type.label, color: colors.text }}>{feature.label}</Text>
                  <Text numberOfLines={2} style={{ ...type.caption, color: colors.textMuted }}>{feature.description}</Text>
                  <Text style={{ ...type.caption, color: colors.primary }}>{supportLabel(feature.support)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={19} color={colors.textMuted} />
              </Pressable>
            ))}
          </View>
        );
      })}
    </Screen>
  );
}
