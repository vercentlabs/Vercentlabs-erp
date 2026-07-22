import { Redirect } from "expo-router";

import { useAuth } from "@/core/auth/auth-provider";
import { LoadingScreen } from "@/shared/components/loading-screen";

export default function Index() {
  const auth = useAuth();
  if (auth.status === "booting") return <LoadingScreen />;
  return (
    <Redirect href={auth.status === "signed-in" ? "/(protected)/(tabs)" : "/(auth)/login"} />
  );
}
