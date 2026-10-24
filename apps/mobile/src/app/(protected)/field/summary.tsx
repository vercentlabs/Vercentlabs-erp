// The salesperson's day (Sales report Phase 4): orders taken and their value, money collected by method, and how many of the beat's
// retailers were seen (an order or a payment). Needs a connection: it is worked out on the server.
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";

import { loadFieldSummary, type FieldSummary } from "@/core/field/field-store";
import { AppHeader } from "@/shared/components/app-header";
import { Button } from "@/shared/components/button";
import { Screen } from "@/shared/components/screen";
import { useTheme } from "@/shared/theme/theme";

const rupees = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

export default function DaySummaryScreen() {
  const { colors, radii, spacing, type } = useTheme();
  const [summary, setSummary] = useState<FieldSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    void loadFieldSummary().then((result) => { setSummary(result); setError(null); })
      .catch(() => setError("The summary needs a connection. Sync first, then open it again."));
  }, []));
  const tile = (label: string, value: string, detail?: string) => (
    <View key={label} style={{ flexGrow: 1, minWidth: 150, width: "48%", gap: spacing.xxs, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md,
      backgroundColor: colors.surface }}>
      <Text style={{ ...type.caption, color: colors.textSecondary }}>{label}</Text>
      <Text style={{ ...type.heading, color: colors.text }}>{value}</Text>
      {detail ? <Text style={{ ...type.caption, color: colors.textMuted }}>{detail}</Text> : null}
    </View>
  );
  return (
    <Screen>
      <AppHeader eyebrow="Today's beat" title="Day's summary" />
      <View style={{ gap: spacing.lg }}>
        {error && <Text accessibilityRole="alert" style={{ ...type.body, color: colors.warning }}>{error}</Text>}
        {summary && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {tile("Orders", String(summary.orders.count), rupees(summary.orders.total))}
            {tile("Collected", rupees(summary.collected.total), summary.collected.byMethod.map((row) => `${row.label} ${rupees(row.total)}`).join(" · ") || "Nothing yet")}
            {tile("Retailers seen", `${summary.retailers.seen} of ${summary.retailers.onBeat}`, "An order or a payment")}
          </View>
        )}
        <Button variant="secondary" label="Back to today's beat" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
