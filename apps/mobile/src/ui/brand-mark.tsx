import { View } from "react-native";

import { useTheme } from "@/theme/theme";

export function BrandMark({ size = 44 }: { size?: number }) {
  const { colors, radii } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: radii.md,
        backgroundColor: colors.primary,
        alignItems: "center",
        justifyContent: "center",
        transform: [{ rotate: "-8deg" }],
      }}
    >
      <View
        style={{
          width: size * 0.48,
          height: size * 0.48,
          borderLeftWidth: Math.max(3, size * 0.09),
          borderBottomWidth: Math.max(3, size * 0.09),
          borderColor: colors.inverse,
          transform: [{ rotate: "-37deg" }],
        }}
      />
    </View>
  );
}
