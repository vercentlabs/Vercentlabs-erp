import { Redirect, Stack } from "expo-router";

import { useAuth } from "@/auth/auth-provider";
import { LoadingScreen } from "@/ui/loading-screen";

export default function AuthLayout() {
  const auth = useAuth();
  if (auth.status === "booting") return <LoadingScreen />;
  if (auth.status === "signed-in") return <Redirect href="/(app)" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
