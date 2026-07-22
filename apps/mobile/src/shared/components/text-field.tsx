import { forwardRef } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";

import { useTheme } from "@/shared/theme/theme";

type Props = TextInputProps & {
  label: string;
  error?: string;
  trailing?: React.ReactNode;
};

export const TextField = forwardRef<TextInput, Props>(function TextField(
  { label, error, trailing, style, ...props },
  ref,
) {
  const { colors, radii, spacing, type } = useTheme();
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ ...type.caption, color: colors.textSecondary }}>
        {label}
      </Text>
      <View
        style={{
          minHeight: 52,
          borderWidth: 1,
          borderColor: error ? colors.danger : colors.border,
          borderRadius: radii.md,
          backgroundColor: colors.surface,
          paddingHorizontal: spacing.md,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.primary}
          style={[
            {
              ...type.body,
              color: colors.text,
              minHeight: 50,
              flex: 1,
              paddingVertical: 0,
            },
            style,
          ]}
          {...props}
        />
        {trailing}
      </View>
      {error ? (
        <Text
          accessibilityRole="alert"
          style={{ ...type.caption, color: colors.danger }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
});
