import { ScrollView, View, type ScrollViewProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "@/shared/theme/theme";

export function Screen({
  children,
  contentContainerStyle,
  ...props
}: ScrollViewProps) {
  const { colors, spacing } = useTheme();
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      edges={["top"]}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          { padding: spacing.md, paddingBottom: spacing.hero, flexGrow: 1 },
          contentContainerStyle,
        ]}
        {...props}
      >
        <View
          style={{ width: "100%", maxWidth: 1520, alignSelf: "center", flex: 1 }}
        >
          {children}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
