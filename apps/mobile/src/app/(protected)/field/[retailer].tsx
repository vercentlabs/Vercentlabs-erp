// Quick order in the shop (Sales report Phase 4): the retailer's last order filled in, quantities changed with + and −, other products
// found by name, then Save order — sent now when online, else kept until Sync. Below it, collect cash, a cheque or UPI on the spot,
// with the receipt sent on WhatsApp. Totals here use list prices; schemes, discounts and tax are worked out when the order is saved.
import { useCallback, useMemo, useState } from "react";
import { Linking, Pressable, Text, TextInput, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { collectPayment, loadFieldDay, takeOrder, todayOnPhone, type FieldCollectionResult, type FieldDay, type FieldOrderResult } from "@/core/field/field-store";
import { AppHeader } from "@/shared/components/app-header";
import { Button } from "@/shared/components/button";
import { Screen } from "@/shared/components/screen";
import { Section } from "@/shared/components/section";
import { TextField } from "@/shared/components/text-field";
import { useTheme } from "@/shared/theme/theme";

const rupees = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
const METHODS = [{ key: "cash", label: "Cash" }, { key: "upi", label: "UPI" }, { key: "cheque", label: "Cheque" }] as const;

export default function QuickOrderScreen() {
  const { retailer: retailerId } = useLocalSearchParams<{ retailer: string }>();
  const { colors, radii, spacing, type } = useTheme();
  const [day, setDay] = useState<FieldDay | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [order, setOrder] = useState<{ result?: FieldOrderResult; queued?: boolean; error?: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof METHODS)[number]["key"]>("cash");
  const [chequeNumber, setChequeNumber] = useState("");
  const [chequeDate, setChequeDate] = useState(todayOnPhone());
  const [reference, setReference] = useState("");
  const [collecting, setCollecting] = useState(false);
  const [collection, setCollection] = useState<{ result?: FieldCollectionResult; queued?: boolean; error?: string } | null>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    void loadFieldDay().then((loaded) => {
      if (!active || !loaded.day) return;
      setDay(loaded.day);
      const found = loaded.day.retailers.find((row) => row.id === retailerId);
      // The last order, ready to repeat.
      setQuantities((current) => (Object.keys(current).length ? current
        : Object.fromEntries((found?.lastOrder ?? []).map((line) => [line.itemId, line.quantity]))));
    });
    return () => { active = false; };
  }, [retailerId]));

  const retailer = day?.retailers.find((row) => row.id === retailerId) ?? null;
  const products = useMemo(() => day?.products ?? [], [day]);
  const chosen = products.filter((product) => (quantities[product.id] ?? 0) > 0);
  const found = search.trim().length >= 2
    ? products.filter((product) => !((quantities[product.id] ?? 0) > 0) && `${product.name} ${product.code}`.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 20) : [];
  const estimate = chosen.reduce((total, product) => total + (product.price ?? 0) * (quantities[product.id] ?? 0), 0);
  const set = (id: string, quantity: number) => { setOrder(null); setQuantities((current) => ({ ...current, [id]: Math.max(0, Math.round(quantity)) })); };

  async function saveOrder() {
    setSaving(true);
    try {
      const sent = await takeOrder({ partyId: retailerId, orderDate: todayOnPhone(), note: note.trim() || undefined,
        lines: chosen.map((product) => ({ itemId: product.id, quantity: quantities[product.id] ?? 0, uomId: product.uomId ?? undefined })) });
      setOrder(sent.sent ? { result: sent.result } : { queued: true });
    } catch (error) {
      setOrder({ error: (error as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function saveCollection() {
    setCollecting(true);
    try {
      const sent = await collectPayment({ partyId: retailerId, amount: Number(amount), method,
        ...(method === "cheque" ? { chequeNumber: chequeNumber.trim(), chequeDate } : {}), ...(method === "upi" && reference.trim() ? { reference: reference.trim() } : {}) });
      setCollection(sent.sent ? { result: sent.result } : { queued: true });
      setAmount("");
    } catch (error) {
      setCollection({ error: (error as Error).message });
    } finally {
      setCollecting(false);
    }
  }

  const row = (id: string, name: string, detail: string) => (
    <View key={id} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md,
      backgroundColor: colors.surface }}>
      <View style={{ flex: 1 }}>
        <Text style={{ ...type.label, color: colors.text }}>{name}</Text>
        <Text style={{ ...type.caption, color: colors.textMuted }}>{detail}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`One less ${name}`} onPress={() => set(id, (quantities[id] ?? 0) - 1)}
        style={{ minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.md, backgroundColor: colors.primarySoft }}>
        <Text style={{ ...type.heading, color: colors.primary }}>−</Text>
      </Pressable>
      <QuantityInput value={quantities[id] ?? 0} label={`Quantity of ${name}`} onChange={(value) => set(id, value)} />
      <Pressable accessibilityRole="button" accessibilityLabel={`One more ${name}`} onPress={() => set(id, (quantities[id] ?? 0) + 1)}
        style={{ minWidth: 48, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.md, backgroundColor: colors.primarySoft }}>
        <Text style={{ ...type.heading, color: colors.primary }}>+</Text>
      </Pressable>
    </View>
  );

  return (
    <Screen>
      <AppHeader eyebrow="Quick order" title={retailer?.name ?? "Retailer"} description={retailer && retailer.due > 0 ? `${rupees(retailer.due)} due` : undefined} />
      <View style={{ gap: spacing.xl }}>
        <Section title="Order" detail={chosen.length ? `${chosen.length} products · about ${rupees(estimate)} at list price` : "Add products below."}>
          {chosen.map((product) => row(product.id, product.name, `${product.unit ?? ""}${product.price !== null ? ` · ${rupees(product.price)}` : ""}`))}
          <TextField label="Add a product" value={search} onChangeText={setSearch} placeholder="Type 2 letters of its name or code" autoCorrect={false} />
          {found.map((product) => (
            <Pressable key={product.id} accessibilityRole="button" onPress={() => { set(product.id, 1); setSearch(""); }}
              style={{ minHeight: 48, justifyContent: "center", padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ ...type.label, color: colors.text }}>{`Add ${product.name}`}</Text>
              <Text style={{ ...type.caption, color: colors.textMuted }}>{`${product.code}${product.price !== null ? ` · ${rupees(product.price)}` : ""}`}</Text>
            </Pressable>
          ))}
          <TextField label="Note (optional)" value={note} onChangeText={setNote} placeholder="For example: deliver after 4 pm" />
          <Button label={saving ? "Saving…" : "Save order"} loading={saving} disabled={!chosen.length || Boolean(order?.result || order?.queued)} onPress={() => void saveOrder()} />
          {order?.result && (
            <View style={{ gap: spacing.xxs, padding: spacing.sm, borderRadius: radii.md, backgroundColor: order.result.confirmed ? colors.successSoft : colors.warningSoft }}>
              <Text style={{ ...type.label, color: order.result.confirmed ? colors.success : colors.warning }}>
                {`${order.result.orderNumber}: ${rupees(order.result.total)}${order.result.confirmed ? ", confirmed" : ", saved as a draft"}`}
              </Text>
              {order.result.freeGoods.map((line) => <Text key={line.name} style={{ ...type.caption, color: colors.textSecondary }}>{`Free: ${line.quantity} ${line.name}`}</Text>)}
              {order.result.problems.map((problem) => <Text key={problem} style={{ ...type.caption, color: colors.warning }}>{problem}</Text>)}
            </View>
          )}
          {order?.queued && <Text style={{ ...type.caption, color: colors.warning }}>Saved on the phone. It is sent when you Sync with a connection.</Text>}
          {order?.error && <Text accessibilityRole="alert" style={{ ...type.caption, color: colors.danger }}>{order.error}</Text>}
        </Section>

        <Section title="Collect payment" detail="Cash, UPI or a cheque, recorded against what the retailer owes.">
          <View style={{ flexDirection: "row", gap: spacing.xs }}>
            {METHODS.map((option) => (
              <Pressable key={option.key} accessibilityRole="button" accessibilityState={{ selected: method === option.key }} onPress={() => setMethod(option.key)}
                style={{ flex: 1, minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.md, borderWidth: 1,
                  borderColor: method === option.key ? colors.primary : colors.border, backgroundColor: method === option.key ? colors.primarySoft : colors.surface }}>
                <Text style={{ ...type.label, color: method === option.key ? colors.primary : colors.text }}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextField label="Amount (₹)" value={amount} onChangeText={(value) => setAmount(value.replace(/[^\d.]/g, ""))} keyboardType="decimal-pad" />
          {method === "cheque" && <>
            <TextField label="Cheque number" value={chequeNumber} onChangeText={setChequeNumber} keyboardType="number-pad" />
            <TextField label="Date on the cheque (YYYY-MM-DD)" value={chequeDate} onChangeText={setChequeDate} />
          </>}
          {method === "upi" && <TextField label="UPI reference (optional)" value={reference} onChangeText={setReference} />}
          <Button label="Save payment" variant="secondary" loading={collecting}
            disabled={!(Number(amount) > 0) || (method === "cheque" && (!chequeNumber.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(chequeDate)))} onPress={() => void saveCollection()} />
          {collection?.result && (
            <View style={{ gap: spacing.xs }}>
              <Text style={{ ...type.label, color: colors.success }}>
                {collection.result.postDated ? "The cheque is kept until its date." : `Receipt ${collection.result.receiptNumber}: ${rupees(collection.result.amount)} received.`}
              </Text>
              <Button label="Send receipt on WhatsApp" onPress={() => void Linking.openURL(collection.result!.whatsappUrl)} />
            </View>
          )}
          {collection?.queued && <Text style={{ ...type.caption, color: colors.warning }}>Saved on the phone. The receipt is ready to send after Sync.</Text>}
          {collection?.error && <Text accessibilityRole="alert" style={{ ...type.caption, color: colors.danger }}>{collection.error}</Text>}
        </Section>
        <Button variant="quiet" label="Back to today's beat" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

function QuantityInput({ value, label, onChange }: { value: number; label: string; onChange: (value: number) => void }) {
  const { colors, radii, type } = useTheme();
  return (
    <TextInput accessibilityLabel={label} keyboardType="number-pad" value={String(value)} onChangeText={(text) => onChange(Number(text.replace(/\D/g, "")) || 0)}
      style={{ ...type.label, width: 64, minHeight: 48, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, textAlign: "center" }} />
  );
}
