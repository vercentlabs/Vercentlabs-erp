import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router, type Href } from "expo-router";

import { mobileApi } from "@/core/api/client";
import { AppHeader } from "@/shared/components/app-header";
import { QueryState, StatusPill } from "@/shared/components/crm-states";
import { Screen } from "@/shared/components/screen";
import { useTheme } from "@/shared/theme/theme";

export default function SearchScreen() {
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  const { colors, radii, spacing, type } = useTheme();
  const query = useQuery({ queryKey: ["mobile-search", term], queryFn: () => mobileApi.search(term), enabled: term.length >= 2 });
  return (
    <Screen keyboardShouldPersistTaps="handled">
      <AppHeader eyebrow="Global search" title={term ? `Results for “${term}”` : "Search the workspace"} description="Search only the organisation, master-data and CRM records your role can access." />
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <TextInput autoFocus value={input} onChangeText={setInput} onSubmitEditing={() => setTerm(input.trim())} returnKeyType="search" accessibilityLabel="Search workspace" placeholder="Partners, items, companies, branches or users" placeholderTextColor={colors.textMuted} style={{ flex: 1, minHeight: 48, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md, ...type.body, color: colors.text }} />
        <Pressable accessibilityRole="button" onPress={() => setTerm(input.trim())} style={{ minWidth: 68, justifyContent: "center", alignItems: "center", borderRadius: radii.sm, backgroundColor: colors.primary }}><Text style={{ ...type.label, color: colors.inverse }}>Find</Text></Pressable>
      </View>
      <View style={{ gap: spacing.sm, marginTop: spacing.xl }}>
        <QueryState loading={query.isLoading} error={query.error} empty={Boolean(term) && !query.data?.results.length} onRetry={() => void query.refetch()} />
        {query.data?.results.map((result, index) => (
          <Pressable key={`${result.resource}-${String(result.record.id ?? index)}`} onPress={() => router.push(result.href as Href)} style={{ minHeight: 96, padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xs }}>
            <StatusPill value={result.resource} />
            <Text style={{ ...type.label, color: colors.text }}>{result.title}</Text>
            <Text numberOfLines={2} style={{ ...type.caption, color: colors.textMuted }}>{result.subtitle}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
