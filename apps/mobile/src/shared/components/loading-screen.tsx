import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "@/shared/theme/theme";
import { BrandMark } from "./brand-mark";

export function LoadingScreen() {
  const { colors, spacing, type } = useTheme();
  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: colors.navigation,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View style={{ alignItems: "center", gap: spacing.lg }}>
        <BrandMark size={56} />
        <Text style={{ ...type.heading, color: colors.inverse }}>
          Vercent ERP
        </Text>
        <ActivityIndicator
          color={colors.inverse}
          accessibilityLabel="Opening secure workspace"
        />
      </View>
    </SafeAreaView>
  );
}
