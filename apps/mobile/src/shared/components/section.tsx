import type { PropsWithChildren } from "react";
import { Text, View } from "react-native";
import { useTheme } from "@/shared/theme/theme";

export function Section({ title, detail, children }: PropsWithChildren<{ title: string; detail?: string }>) {
  const { colors, spacing, type } = useTheme();
  return <View style={{ gap: spacing.md }}>
    <View style={{ gap: 2 }}><Text accessibilityRole="header" style={{ ...type.heading, color: colors.text }}>{title}</Text>{detail ? <Text style={{ ...type.caption, color: colors.textMuted }}>{detail}</Text> : null}</View>
    {children}
  </View>;
}

