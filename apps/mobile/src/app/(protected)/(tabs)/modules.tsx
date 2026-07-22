import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useAuth } from "@/core/auth/auth-provider";
import { availableModules, mobileModules } from "@/core/modules/catalog";
import { useTheme } from "@/shared/theme/theme";
import { AppHeader } from "@/shared/components/app-header";
import { Screen } from "@/shared/components/screen";
import { Section } from "@/shared/components/section";

export default function ModulesScreen() {
  const auth = useAuth(); const { colors, radii, spacing, type } = useTheme(); const permissions = auth.session?.access.permissions ?? []; const enabled = availableModules(permissions); const roadmap = mobileModules.filter((module) => !module.enabled);
  return <Screen><AppHeader eyebrow="Workspace" title="Modules" /><Section title="Ready to use" detail="Only modules enabled for your role appear here."><View style={{ gap: spacing.sm }}>{enabled.map((module) => <Pressable key={module.key} accessibilityRole="button" onPress={() => module.href && router.push(module.href)} style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 84, padding: spacing.lg, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}><View style={{ width: 48, height: 48, borderRadius: radii.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft }}><Ionicons name={module.icon} size={24} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={{ ...type.label, color: colors.text }}>{module.name}</Text><Text numberOfLines={2} style={{ ...type.caption, color: colors.textMuted }}>{module.description}</Text></View><Ionicons name="chevron-forward" size={20} color={colors.textMuted} /></Pressable>)}</View></Section><View style={{ height: spacing.xxl }} /><Section title="Product roadmap" detail="These modules stay hidden from operational navigation until their APIs and workflows are released."><View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>{roadmap.map((module) => <View key={module.key} style={{ width: "48%", minWidth: 145, flexGrow: 1, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.sm }}><Ionicons name={module.icon} size={21} color={colors.textMuted} /><Text style={{ ...type.label, color: colors.text }}>{module.name}</Text><Text style={{ ...type.caption, color: colors.textMuted }}>Planned</Text></View>)}</View></Section></Screen>;
}
