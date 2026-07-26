import * as LocalAuthentication from "expo-local-authentication";
import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import { useTheme } from "@/shared/theme/theme";
import { BrandMark } from "@/shared/components/brand-mark";

export function PrivacyShield({ children }: PropsWithChildren) {
  const [locked, setLocked] = useState(false); const backgroundedAt = useRef(0);
  const { colors, radii, spacing, type } = useTheme();
  async function unlock() {
    const available = await LocalAuthentication.hasHardwareAsync() && await LocalAuthentication.isEnrolledAsync();
    if (!available) { setLocked(false); return; }
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock Vercentlabs ERP", cancelLabel: "Stay locked", disableDeviceFallback: false });
    if (result.success) setLocked(false);
  }
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") backgroundedAt.current = Date.now();
      if (state === "active" && backgroundedAt.current && Date.now() - backgroundedAt.current > 15_000) { setLocked(true); void unlock(); }
    });
    return () => subscription.remove();
  }, []);
  if (!locked) return children;
  return <View accessibilityViewIsModal style={{ flex: 1, backgroundColor: colors.navigation, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.xl }}><BrandMark size={64} /><View style={{ alignItems: "center", gap: spacing.xs }}><Text style={{ ...type.title, color: colors.inverse }}>Workspace locked</Text><Text style={{ ...type.body, color: "#B7C0D0", textAlign: "center" }}>Authenticate to protect customer and revenue information.</Text></View><Pressable accessibilityRole="button" onPress={() => void unlock()} style={{ minHeight: 52, justifyContent: "center", paddingHorizontal: spacing.xl, borderRadius: radii.full, backgroundColor: colors.primary }}><Text style={{ ...type.label, color: colors.inverse }}>Unlock securely</Text></Pressable></View>;
}
