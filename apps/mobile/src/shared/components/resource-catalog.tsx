import { Ionicons } from "@expo/vector-icons";
import type { MobileResourceDefinition } from "@vercentlabs/shared-sdk";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { useTheme } from "@/shared/theme/theme";

function iconFor(group: string | undefined) {
  if (group === "Partners" || group === "Engagement") return "people-outline" as const;
  if (group === "Products") return "cube-outline" as const;
  if (group === "Inventory" || group === "Field Sales") return "location-outline" as const;
  if (group === "Finance" || group === "Analytics") return "analytics-outline" as const;
  if (group === "Configuration") return "settings-outline" as const;
  if (group === "Automation") return "flash-outline" as const;
  return "layers-outline" as const;
}

export function ResourceCatalog({
  area,
  definitions,
}: {
  area: "crm" | "master-data" | "settings";
  definitions: MobileResourceDefinition[];
}) {
  const { colors, radii, spacing, type } = useTheme();
  const groups = [...new Set(definitions.map((item) => item.group || item.eyebrow || "Configuration"))];

  return (
    <View style={{ gap: spacing.xxl }}>
      {groups.map((group) => (
        <View key={group} style={{ gap: spacing.sm }}>
          <View>
            <Text
              style={{
                color: colors.primary,
                fontSize: 10,
                fontWeight: "800",
                letterSpacing: 1,
                textTransform: "uppercase",
              }}
            >
              {group}
            </Text>
            <Text style={{ ...type.heading, color: colors.text }}>
              {group === "Work" ? "Operational CRM" : group}
            </Text>
          </View>
          {definitions
            .filter((item) => (item.group || item.eyebrow || "Configuration") === group)
            .map((definition) => (
              <Pressable
                key={definition.key}
                accessibilityRole="button"
                onPress={() =>
                  router.push({
                    pathname: "/(protected)/workspace/[area]/[resource]",
                    params: { area, resource: definition.key },
                  })
                }
                style={({ pressed }) => ({
                  minHeight: 96,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.md,
                  padding: spacing.md,
                  borderWidth: 1,
                  borderColor: pressed ? colors.primary : colors.border,
                  borderRadius: radii.md,
                  backgroundColor: colors.surface,
                })}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 12,
                    backgroundColor: colors.primarySoft,
                  }}
                >
                  <Ionicons name={iconFor(definition.group)} size={21} color={colors.primary} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={{ ...type.label, color: colors.text }}>{definition.title}</Text>
                  <Text numberOfLines={2} style={{ ...type.caption, color: colors.textMuted }}>
                    {definition.description}
                  </Text>
                </View>
                <Ionicons name="arrow-forward" size={18} color={colors.textMuted} />
              </Pressable>
            ))}
        </View>
      ))}
    </View>
  );
}
