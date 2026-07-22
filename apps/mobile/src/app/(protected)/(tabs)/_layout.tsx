import { Ionicons } from "@expo/vector-icons";
import { Redirect, Tabs } from "expo-router";

import { useAuth } from "@/core/auth/auth-provider";
import { useTheme } from "@/shared/theme/theme";
import { LoadingScreen } from "@/shared/components/loading-screen";

const icons = {
  index: ["home", "home-outline"],
  leads: ["people", "people-outline"],
  pipeline: ["git-network", "git-network-outline"],
  activities: ["checkmark-circle", "checkmark-circle-outline"],
  modules: ["apps", "apps-outline"],
  more: ["grid", "grid-outline"],
} as const;

export default function AppLayout() {
  const auth = useAuth();
  const { colors, type } = useTheme();
  if (auth.status === "booting") return <LoadingScreen />;
  if (auth.status === "signed-out") return <Redirect href="/(auth)/login" />;
  return (
    <Tabs
      initialRouteName="index"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          minHeight: 72,
          paddingTop: 8,
          paddingBottom: 10,
        },
        tabBarLabelStyle: { ...type.caption, fontSize: 12 },
        tabBarIcon: ({ color, focused, size }) => {
          const pair = icons[route.name as keyof typeof icons] || icons.more;
          return (
            <Ionicons
              name={focused ? pair[0] : pair[1]}
              size={size}
              color={color}
            />
          );
        },
      })}
    >
      <Tabs.Screen name="leads" options={{ title: "CRM" }} />
      <Tabs.Screen name="activities" options={{ title: "Work" }} />
      <Tabs.Screen name="modules" options={{ title: "Modules" }} />
      <Tabs.Screen name="more" options={{ title: "More" }} />
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="pipeline" options={{ href: null }} />
      <Tabs.Screen name="search" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
    </Tabs>
  );
}
