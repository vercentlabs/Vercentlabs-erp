import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";

import { authErrorMessage, useAuth } from "@/core/auth/auth-provider";
import { appConfig } from "@/core/config";
import { BrandMark } from "@/shared/components/brand-mark";
import { Button } from "@/shared/components/button";
import { Screen } from "@/shared/components/screen";
import { TextField } from "@/shared/components/text-field";
import { useTheme } from "@/shared/theme/theme";
import { minimumTouchTarget } from "@/shared/theme/tokens";

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
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen contentContainerStyle={{ padding: spacing.md, paddingTop: 28 }}>
        <View style={{ width: "100%", maxWidth: 520, alignSelf: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.lg }}>
          <BrandMark size={40} />
          <Text style={{ ...type.heading, color: colors.text }}>Vercent ERP</Text>
        </View>
        <View style={{ padding: 22, borderWidth: 1, borderColor: colors.border, borderRadius: 20, backgroundColor: colors.surface, gap: spacing.lg }}>
          <View style={{ gap: spacing.xs }}>
            <Text style={{ color: colors.primary, fontSize: 11, fontWeight: "800", letterSpacing: 1.1, textTransform: "uppercase" }}>Welcome back</Text>
            <Text accessibilityRole="header" style={{ ...type.title, color: colors.text }}>Sign in to your ERP workspace</Text>
            <Text style={{ ...type.body, color: colors.textMuted }}>Use your verified work account to continue.</Text>
          </View>
          {error ? <View accessibilityRole="alert" style={{ flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.dangerSoft }}><Ionicons name="alert-circle-outline" size={21} color={colors.danger} /><Text style={{ ...type.caption, color: colors.danger, flex: 1 }}>{error}</Text></View> : null}
          <TextField label="Work email" value={email} onChangeText={setEmail} placeholder="you@company.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="username" returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} />
          <TextField ref={passwordRef} label="Password" value={password} onChangeText={setPassword} placeholder="Enter your password" secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password" returnKeyType="go" onSubmitEditing={submit} trailing={<Pressable accessibilityRole="button" accessibilityLabel={showPassword ? "Hide password" : "Show password"} hitSlop={8} onPress={() => setShowPassword((value) => !value)} style={{ minWidth: minimumTouchTarget, minHeight: minimumTouchTarget, alignItems: "center", justifyContent: "center" }}><Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={22} color={colors.textMuted} /></Pressable>} />
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`${appConfig.apiUrl}/forgot-password`)} style={{ minHeight: minimumTouchTarget, alignSelf: "flex-end", justifyContent: "center" }}><Text style={{ ...type.label, color: colors.primary }}>Forgot password?</Text></Pressable>
          <Button label="Sign in securely" loading={loading} disabled={!email.trim() || !password} onPress={submit} />
          <View style={{ paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}><Text style={{ ...type.body, textAlign: "center", color: colors.textMuted }}>New to Vercent ERP? <Text style={{ color: colors.primary, fontWeight: "700" }} onPress={() => Linking.openURL(`${appConfig.apiUrl}/signup`)}>Create an account</Text></Text></View>
        </View>
        <Text style={{ ...type.caption, color: colors.textMuted, textAlign: "center", margin: spacing.xl }}>Protected by secure sessions, rate controls and auditable account events.</Text>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
