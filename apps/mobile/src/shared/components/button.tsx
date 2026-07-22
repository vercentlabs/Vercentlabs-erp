import {
  ActivityIndicator,
  Pressable,
  Text,
  type PressableProps,
} from "react-native";

import { useTheme } from "@/shared/theme/theme";
import { minimumTouchTarget } from "@/shared/theme/tokens";

type Props = PressableProps & {
  label: string;
  loading?: boolean;
  variant?: "primary" | "secondary" | "quiet";
};

export function Button({
  label,
  loading = false,
  variant = "primary",
  disabled,
  style,
  ...props
}: Props) {
  const { colors, radii, spacing, type } = useTheme();
  const background =
    variant === "primary"
      ? colors.primary
      : variant === "secondary"
        ? colors.primarySoft
        : "transparent";
  const foreground = variant === "primary" ? colors.inverse : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{
        disabled: Boolean(disabled || loading),
        busy: loading,
      }}
      disabled={disabled || loading}
      style={(state) => [
        {
          minHeight: minimumTouchTarget,
          paddingHorizontal: spacing.lg,
          borderRadius: radii.md,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: spacing.xs,
          backgroundColor: background,
          opacity: disabled ? 0.5 : state.pressed ? 0.82 : 1,
        },
        typeof style === "function" ? style(state) : style,
      ]}
      {...props}
    >
      {loading ? <ActivityIndicator color={foreground} /> : null}
      <Text style={{ ...type.label, color: foreground }}>{label}</Text>
    </Pressable>
  );
}
