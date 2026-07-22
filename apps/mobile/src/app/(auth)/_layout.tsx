import { Redirect, Stack } from "expo-router";

import { useAuth } from "@/core/auth/auth-provider";
import { LoadingScreen } from "@/shared/components/loading-screen";

export default function AuthLayout() {
  const auth = useAuth();
  if (auth.status === "booting") return <LoadingScreen />;
  if (auth.status === "signed-in") return <Redirect href="/(protected)/(tabs)" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
