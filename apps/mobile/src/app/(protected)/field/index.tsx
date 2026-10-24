// Today's beat (Sales report Phase 4): the salesperson's retailers for today with what each owes and whether an order was taken, the
// offline state, what is waiting to be sent and Sync, and the day's summary.
import { useCallback, useState } from "react";
import { Linking, Pressable, RefreshControl, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import { loadFieldDay, syncField, waiting, type FieldDay, type FieldCollectionResult } from "@/core/field/field-store";
import { AppHeader } from "@/shared/components/app-header";
import { Button } from "@/shared/components/button";
import { Screen } from "@/shared/components/screen";
import { TextField } from "@/shared/components/text-field";
import { useTheme } from "@/shared/theme/theme";

const rupees = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

export default function TodaysBeatScreen() {
  const { colors, radii, spacing, type } = useTheme();
  const [day, setDay] = useState<FieldDay | null>(null);
  const [offline, setOffline] = useState(false);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [queue, setQueue] = useState({ orders: 0, collections: 0 });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<FieldCollectionResult[]>([]);
  const [search, setSearch] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await loadFieldDay();
      setDay(loaded.day);
      setOffline(loaded.offline);
      setCachedAt(loaded.cachedAt);
      setQueue(await waiting());
      setMessage(null);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  async function sync() {
    setSyncing(true);
    const result = await syncField();
    setReceipts((current) => [...result.receipts, ...current]);
    setMessage(result.failed ? `${result.sent} sent, ${result.failed} still waiting. Try again with a better connection.` : `${result.sent} sent.`);
    setSyncing(false);
    await refresh();
  }

  const waitingCount = queue.orders + queue.collections;
  const retailers = (day?.retailers ?? []).filter((row) => !search.trim() || row.name.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <Screen refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} />}>
      <AppHeader eyebrow="Sales" title="Today's beat" />
      <View style={{ gap: spacing.md }}>
        <Text style={{ ...type.caption, color: colors.textSecondary }}>
          {day ? `${day.beats.map((beat) => beat.name).join(", ") || "No beat today"} · ${day.retailers.length} retailers` : loading ? "Loading…" : "Not loaded yet"}
        </Text>
        {offline && (
          <View style={{ padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.warningSoft }}>
            <Text style={{ ...type.caption, color: colors.warning }}>
              {`Offline. ${cachedAt ? `Showing the beat saved at ${new Date(cachedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}.` : "Open this once online to save the beat."} Orders and payments wait until Sync.`}
            </Text>
          </View>
        )}
        {waitingCount > 0 && (
          <Button label={`Sync ${waitingCount} waiting (${queue.orders} ${queue.orders === 1 ? "order" : "orders"}, ${queue.collections} ${queue.collections === 1 ? "payment" : "payments"})`}
            loading={syncing} onPress={() => void sync()} />
        )}
        {message && <Text accessibilityRole="alert" style={{ ...type.caption, color: colors.textSecondary }}>{message}</Text>}
        {receipts.map((receipt, index) => (
          <Button key={`${receipt.receiptNumber}-${index}`} variant="secondary" label={`Send receipt ${receipt.receiptNumber ?? ""} on WhatsApp`.replace("  ", " ")}
            onPress={() => void Linking.openURL(receipt.whatsappUrl)} />
        ))}
        <Button variant="secondary" label="Day's summary" onPress={() => router.push("/(protected)/field/summary")} />
        <TextField label="Find a retailer" value={search} onChangeText={setSearch} placeholder="Name" autoCorrect={false} />
        {!loading && day && retailers.length === 0 && (
          <Text style={{ ...type.body, color: colors.textSecondary }}>
            {day.beats.length ? "No retailers match." : "You have no beat today. Beats and their days are set in Sales › Beats."}
          </Text>
        )}
        {retailers.map((retailer) => (
          <Pressable key={retailer.id} accessibilityRole="button" accessibilityLabel={`Take an order for ${retailer.name}`}
            onPress={() => router.push({ pathname: "/(protected)/field/[retailer]", params: { retailer: retailer.id } })}
            style={({ pressed }) => ({ minHeight: 72, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1,
              borderColor: pressed ? colors.primary : colors.border, borderRadius: radii.md, backgroundColor: colors.surface })}>
            <Ionicons name={retailer.orderedToday ? "checkmark-circle" : "storefront-outline"} size={24} color={retailer.orderedToday ? colors.success : colors.primary} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ ...type.label, color: colors.text }}>{retailer.name}</Text>
              <Text style={{ ...type.caption, color: colors.textMuted }}>
                {[retailer.orderedToday ? "Order taken today" : retailer.lastOrder.length ? `Last order: ${retailer.lastOrder.length} products` : "No orders yet",
                  retailer.due > 0 ? `${rupees(retailer.due)} due` : null].filter(Boolean).join(" · ")}
              </Text>
            </View>
            <Text style={{ ...type.caption, color: colors.primary }}>Take order</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}
