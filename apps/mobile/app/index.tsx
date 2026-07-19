import { Redirect } from "expo-router";

import { useAuth } from "@/auth/auth-provider";
import { LoadingScreen } from "@/ui/loading-screen";

export default function Index() {
  const auth = useAuth();
  if (auth.status === "booting") return <LoadingScreen />;
  return (
    <Redirect href={auth.status === "signed-in" ? "/(app)" : "/(auth)/login"} />
  );
}
