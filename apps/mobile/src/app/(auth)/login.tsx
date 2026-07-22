import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import { authErrorMessage, useAuth } from "@/core/auth/auth-provider";
import { appConfig } from "@/core/config";
import { useTheme } from "@/shared/theme/theme";
import { minimumTouchTarget } from "@/shared/theme/tokens";
import { BrandMark } from "@/shared/components/brand-mark";
import { Button } from "@/shared/components/button";
import { Screen } from "@/shared/components/screen";
import { TextField } from "@/shared/components/text-field";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const { colors, radii, spacing, type } = useTheme();
  const passwordRef = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!email.trim() || !password || loading) return;
    setLoading(true);
    setError("");
    try {
      await signIn(email, password);
    } catch (caught) {
      setError(authErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen contentContainerStyle={{ padding: 0 }}>
        <View
          style={{
            backgroundColor: colors.navigation,
            paddingHorizontal: spacing.xl,
            paddingTop: spacing.hero,
            paddingBottom: 68,
            minHeight: 310,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.sm,
            }}
          >
            <BrandMark />
            <View>
              <Text style={{ ...type.heading, color: colors.inverse }}>
                Vercent ERP
              </Text>
              <Text style={{ ...type.caption, color: "#98A2B3" }}>
                Mobile workspace
              </Text>
            </View>
          </View>
          <View style={{ marginTop: spacing.hero, gap: spacing.sm }}>
            <Text
              style={{ ...type.display, color: colors.inverse, maxWidth: 410 }}
            >
              Run your day, not your desk.
            </Text>
            <Text style={{ ...type.body, color: "#B7C0D0", maxWidth: 460 }}>
              Your pipeline, priorities and customer context—securely available
              wherever work happens.
            </Text>
          </View>
        </View>

        <View
          style={{
            marginTop: -28,
            marginHorizontal: spacing.md,
            padding: spacing.xl,
            borderRadius: radii.xl,
            backgroundColor: colors.surfaceRaised,
            borderWidth: 1,
            borderColor: colors.border,
            gap: spacing.lg,
            shadowColor: "#000000",
            shadowOpacity: 0.08,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 10 },
            elevation: 4,
          }}
        >
          <View style={{ gap: spacing.xs }}>
            <Text
              accessibilityRole="header"
              style={{ ...type.title, color: colors.text }}
            >
              Welcome back
            </Text>
            <Text style={{ ...type.body, color: colors.textMuted }}>
              Sign in with your organisation account.
            </Text>
          </View>

          {error ? (
            <View
              accessibilityRole="alert"
              style={{
                flexDirection: "row",
                gap: spacing.sm,
                padding: spacing.md,
                borderRadius: radii.md,
                backgroundColor: colors.dangerSoft,
              }}
            >
              <Ionicons
                name="alert-circle-outline"
                size={21}
                color={colors.danger}
              />
              <Text style={{ ...type.caption, color: colors.danger, flex: 1 }}>
                {error}
              </Text>
            </View>
          ) : null}

          <TextField
            label="Work email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@company.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="username"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
          <TextField
            ref={passwordRef}
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Enter your password"
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
            trailing={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  showPassword ? "Hide password" : "Show password"
                }
                hitSlop={8}
                onPress={() => setShowPassword((value) => !value)}
                style={{
                  minWidth: minimumTouchTarget,
                  minHeight: minimumTouchTarget,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons
                  name={showPassword ? "eye-off-outline" : "eye-outline"}
                  size={22}
                  color={colors.textMuted}
                />
              </Pressable>
            }
          />
          <Pressable
            accessibilityRole="link"
            onPress={() =>
              Linking.openURL(`${appConfig.apiUrl}/forgot-password`)
            }
            style={{
              minHeight: minimumTouchTarget,
              alignSelf: "flex-end",
              justifyContent: "center",
            }}
          >
            <Text style={{ ...type.label, color: colors.primary }}>
              Forgot password?
            </Text>
          </Pressable>
          <Button
            label="Sign in securely"
            loading={loading}
            disabled={!email.trim() || !password}
            onPress={submit}
          />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
            }}
          >
            <Ionicons
              name="lock-closed-outline"
              size={16}
              color={colors.success}
            />
            <Text style={{ ...type.caption, color: colors.textMuted, flex: 1 }}>
              Device-bound session with encrypted local storage.
            </Text>
          </View>
        </View>
        <Text
          style={{
            ...type.caption,
            color: colors.textMuted,
            textAlign: "center",
            margin: spacing.xl,
          }}
        >
          By continuing, you agree to your organisation&apos;s security and
          acceptable-use policies.
        </Text>
      </Screen>
    </KeyboardAvoidingView>
  );
}
