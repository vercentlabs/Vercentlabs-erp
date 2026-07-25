import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

import { useAuth } from "@/core/auth/auth-provider";
import { LeadCapture } from "@/modules/crm/components/lead-capture";
import { CrmListScreen } from "@/shared/components/crm-list-screen";
import { useTheme } from "@/shared/theme/theme";

export default function LeadsScreen() {
  const auth = useAuth();
  const { colors, radii, spacing, type } = useTheme();
  const canManage = Boolean(
    auth.session?.access.permissions.includes("crm.leads.manage"),
  );
  return (
    <CrmListScreen
      resource="leads"
      eyebrow="Customer relationships"
      title="CRM"
      titleKeys={["fullName", "companyName", "email"]}
      subtitleKeys={["companyName", "email", "mobile"]}
      icon="person-outline"
      canManage={canManage}
      headerAction={
        <>
          <View
            style={{
              flexDirection: "row",
              gap: spacing.sm,
              marginBottom: spacing.md,
            }}
          >
            <View
              style={{
                flex: 1,
                minHeight: 48,
                borderRadius: radii.full,
                backgroundColor: colors.navigation,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: spacing.xs,
              }}
            >
              <Ionicons name="people" size={18} color={colors.inverse} />
              <Text style={{ ...type.label, color: colors.inverse }}>
                Leads
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(protected)/(tabs)/pipeline")}
              style={{
                flex: 1,
                minHeight: 48,
                borderRadius: radii.full,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.surface,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: spacing.xs,
              }}
            >
              <Ionicons
                name="trending-up-outline"
                size={18}
                color={colors.primary}
              />
              <Text style={{ ...type.label, color: colors.text }}>
                Pipeline
              </Text>
            </Pressable>
          </View>
          {canManage ? <LeadCapture /> : null}
        </>
      }
    />
  );
}
