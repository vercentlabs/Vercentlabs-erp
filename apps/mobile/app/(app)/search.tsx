import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { mobileApi } from "@/api/client";
import { useTheme } from "@/theme/theme";
import { QueryState, StatusPill } from "@/ui/crm-states";
import { Screen } from "@/ui/screen";

export default function SearchScreen() {
  const [input, setInput] = useState(""); const [term, setTerm] = useState("");
  const { colors, radii, spacing, type } = useTheme();
  const query = useQuery({ queryKey: ["mobile-search", term], queryFn: () => mobileApi.search(term), enabled: term.length >= 2 });
  return <Screen keyboardShouldPersistTaps="handled">
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.xl }}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()}><Text style={{ ...type.label, color: colors.primary }}>Back</Text></Pressable><Text accessibilityRole="header" style={{ ...type.title, color: colors.text }}>Search</Text></View>
    <View style={{ flexDirection: "row", gap: spacing.sm }}><TextInput autoFocus value={input} onChangeText={setInput} onSubmitEditing={() => setTerm(input.trim())} returnKeyType="search" accessibilityLabel="Search CRM" placeholder="Lead, deal or activity" placeholderTextColor={colors.textMuted} style={{ flex: 1, minHeight: 52, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md, ...type.body, color: colors.text }} /><Pressable accessibilityRole="button" onPress={() => setTerm(input.trim())} style={{ minWidth: 72, justifyContent: "center", alignItems: "center", borderRadius: radii.md, backgroundColor: colors.primary }}><Text style={{ ...type.label, color: colors.inverse }}>Find</Text></Pressable></View>
    <View style={{ gap: spacing.sm, marginTop: spacing.xl }}>
      <QueryState loading={query.isLoading} error={query.error} empty={Boolean(term) && !query.data?.results.length} onRetry={() => void query.refetch()} />
      {query.data?.results.map(({ resource, record }, index) => <View key={String(record.id ?? index)} style={{ padding: spacing.lg, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs }}><StatusPill value={resource} /><Text style={{ ...type.label, color: colors.text }}>{String(record.fullName ?? record.name ?? record.subject ?? "CRM record")}</Text><Text numberOfLines={2} style={{ ...type.caption, color: colors.textMuted }}>{String(record.companyName ?? record.email ?? record.status ?? record.code ?? "")}</Text></View>)}
    </View>
  </Screen>;
}
