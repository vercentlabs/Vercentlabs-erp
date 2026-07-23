import { Redirect, Stack } from "expo-router";

import { useAuth } from "@/core/auth/auth-provider";
import { LoadingScreen } from "@/shared/components/loading-screen";

export default function ProtectedLayout() {
  const auth = useAuth();

  if (auth.status === "booting") return <LoadingScreen />;
  if (auth.status === "signed-out") return <Redirect href="/(auth)/login" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="workspace/[area]" />
      <Stack.Screen name="workspace/[area]/[resource]" />
      <Stack.Screen name="crm/[resource]/[id]" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="search" />
    </Stack>
  );
}
