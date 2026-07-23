import { Ionicons } from "@expo/vector-icons";
import { useMutation } from "@tanstack/react-query";
import RazorpayCheckout from "react-native-razorpay";
import { useState } from "react";
import { Alert, Linking, Pressable, Text, TextInput, View } from "react-native";

import { mobileApi } from "@/core/api/client";
import { Button } from "@/shared/components/button";
import { StatusPill } from "@/shared/components/crm-states";
import { useTheme } from "@/shared/theme/theme";

type Row = Record<string, unknown>;

function money(value: unknown, currency = "INR") {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(value || 0) / 100);
}

export function BillingManager({ data, onChanged }: { data: Record<string, unknown>; onChanged(): Promise<unknown> | void }) {
  const { colors, radii, spacing, type } = useTheme();
  const summary = (data.summary || {}) as Row;
  const plans = (data.plans as Row[] | undefined) || [];
  const payments = (data.payments as Row[] | undefined) || [];
  const invoices = (data.invoices as Row[] | undefined) || [];
  const sourceProfile = (data.profile || {}) as Row;
  const address = (sourceProfile.billing_address || {}) as Row;
  const defaults = {
    legalName: String(sourceProfile.legal_name || ""),
    billingEmail: String(sourceProfile.billing_email || ""),
    phone: String(sourceProfile.phone || ""),
    gstin: String(sourceProfile.gstin || ""),
    addressLine1: String(address.line1 || ""),
    city: String(address.city || ""),
    state: String(address.state || ""),
    postalCode: String(address.postalCode || ""),
    country: String(address.country || "IN"),
  };
  const [profileEdits, setProfileEdits] = useState<Partial<typeof defaults>>({});
  const [period, setPeriod] = useState<"monthly" | "yearly">("yearly");
  const profile = { ...defaults, ...profileEdits };

  const mutation = useMutation({
    mutationFn: async (input: { kind: "profile" | "cancel" | "checkout"; plan?: Row }) => {
      if (input.kind === "profile") {
        return mobileApi.apiRequest<{ message?: string }>("/billing/profile", { method: "PATCH", body: JSON.stringify(profile) });
      }
      if (input.kind === "cancel") {
        return mobileApi.apiRequest<{ message?: string }>("/billing/cancel", { method: "POST", body: JSON.stringify({ cancelAtCycleEnd: true }) });
      }
      const plan = input.plan;
      if (!plan) throw new Error("Select a billing plan.");
      const checkout = await mobileApi.apiRequest<{
        checkoutSessionId: string;
        keyId: string;
        providerSubscriptionId: string;
        name: string;
        description: string;
        prefill: { name: string; email: string; contact?: string };
      }>("/billing/checkout", { method: "POST", body: JSON.stringify({ planPriceId: plan.id }) });
      const result = await RazorpayCheckout.open({
        key: checkout.keyId,
        subscription_id: checkout.providerSubscriptionId,
        name: checkout.name,
        description: checkout.description,
        prefill: checkout.prefill,
        theme: { color: colors.primary },
      });
      if (!result.razorpay_signature || !result.razorpay_subscription_id) {
        throw new Error("Razorpay did not return a verifiable subscription authorisation.");
      }
      return mobileApi.apiRequest<{ message?: string }>("/billing/verify", {
        method: "POST",
        body: JSON.stringify({
          checkoutSessionId: checkout.checkoutSessionId,
          razorpay_payment_id: result.razorpay_payment_id,
          razorpay_subscription_id: result.razorpay_subscription_id,
          razorpay_signature: result.razorpay_signature,
        }),
      });
    },
    onSuccess: async (result) => {
      await onChanged();
      Alert.alert("Billing updated", result.message || "The billing request completed.");
    },
    onError: (error) => Alert.alert("Billing request not completed", error.message),
  });

  const panel = { padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, gap: spacing.md } as const;
  const visiblePlans = plans.filter((plan) => plan.billingPeriod === period);

  return (
    <View style={{ gap: spacing.xl }}>
      <View style={panel}>
        <View style={{ flexDirection: "row", alignItems: "center" }}><View style={{ flex: 1 }}><Text style={{ ...type.caption, color: colors.primary, textTransform: "uppercase" }}>Current subscription</Text><Text style={{ ...type.heading, color: colors.text }}>{String(summary.planName || "Plan unavailable")}</Text></View><StatusPill value={String(summary.status || "unknown")} /></View>
        {["billingPeriod", "trialEndsAt", "currentPeriodEndsAt", "writeAccess"].map((key) => <View key={key} style={{ flexDirection: "row" }}><Text style={{ ...type.caption, flex: 1, color: colors.textMuted }}>{key.replace(/([A-Z])/g, " $1")}</Text><Text style={{ ...type.caption, color: colors.textSecondary }}>{String(summary[key] ?? "—")}</Text></View>)}
        {data.canManage && !summary.cancelAtCycleEnd ? <Button label="Schedule cancellation" variant="secondary" onPress={() => Alert.alert("Schedule cancellation?", "Your subscription remains active until the current cycle ends.", [{ text: "Keep plan", style: "cancel" }, { text: "Schedule", style: "destructive", onPress: () => mutation.mutate({ kind: "cancel" }) }])} /> : null}
      </View>

      <View style={{ flexDirection: "row", padding: 4, borderRadius: radii.sm, backgroundColor: colors.primarySoft }}>
        {(["monthly", "yearly"] as const).map((value) => <Pressable key={value} onPress={() => setPeriod(value)} style={{ flex: 1, minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: period === value ? colors.surface : "transparent" }}><Text style={{ ...type.label, color: period === value ? colors.primary : colors.textMuted }}>{value === "monthly" ? "Monthly" : "Yearly"}</Text></Pressable>)}
      </View>
      <Text style={{ ...type.heading, color: colors.text }}>Available plans</Text>
      {visiblePlans.map((plan) => <View key={String(plan.id)} style={panel}><View style={{ flexDirection: "row", alignItems: "center" }}><View style={{ flex: 1 }}><Text style={{ ...type.heading, color: colors.text }}>{String(plan.planName)}</Text><Text style={{ ...type.body, color: colors.textMuted }}>{String(plan.description || "")}</Text></View><Text style={{ ...type.heading, color: colors.primary }}>{money(plan.amountPaise, String(plan.currency || "INR"))}</Text></View>{data.canCheckout ? <Button label={mutation.isPending ? "Preparing…" : "Choose plan"} disabled={mutation.isPending} onPress={() => mutation.mutate({ kind: "checkout", plan })} /> : null}</View>)}

      {data.canManage ? <View style={panel}><Text style={{ ...type.heading, color: colors.text }}>Billing profile</Text>{(Object.keys(defaults) as (keyof typeof defaults)[]).map((key) => <View key={key} style={{ gap: 5 }}><Text style={{ ...type.caption, color: colors.textSecondary }}>{key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase())}</Text><TextInput value={profile[key]} onChangeText={(value) => setProfileEdits((current) => ({ ...current, [key]: value }))} keyboardType={key === "billingEmail" ? "email-address" : "default"} autoCapitalize={key === "billingEmail" ? "none" : "sentences"} style={{ ...type.body, minHeight: 48, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, color: colors.text }} /></View>)}<Button label="Save billing profile" loading={mutation.isPending} onPress={() => mutation.mutate({ kind: "profile" })} /></View> : null}

      <Text style={{ ...type.heading, color: colors.text }}>Recent invoices</Text>
      {invoices.map((row, index) => <Pressable disabled={!row.invoice_url} onPress={() => row.invoice_url && void Linking.openURL(String(row.invoice_url))} key={String(row.provider_invoice_id || index)} style={panel}><View style={{ flexDirection: "row" }}><Text style={{ ...type.label, flex: 1, color: colors.text }}>{money(row.amount_paise, String(row.currency || "INR"))}</Text><StatusPill value={String(row.status)} /></View><Text style={{ ...type.caption, color: colors.textMuted }}>{String(row.provider_invoice_id || "Invoice pending")} · {String(row.issued_at || "Not issued")}</Text>{row.invoice_url ? <Text style={{ ...type.label, color: colors.primary }}>Open invoice</Text> : null}</Pressable>)}
      <Text style={{ ...type.heading, color: colors.text }}>Recent payments</Text>
      {payments.map((row, index) => <View key={String(row.provider_payment_id || index)} style={panel}><View style={{ flexDirection: "row" }}><Text style={{ ...type.label, flex: 1, color: colors.text }}>{money(row.amount_paise, String(row.currency || "INR"))}</Text><StatusPill value={String(row.status)} /></View><Text style={{ ...type.caption, color: colors.textMuted }}>{String(row.method || "Payment")} · {String(row.captured_at || row.created_at || "")}</Text></View>)}
      {!invoices.length && !payments.length ? <View style={panel}><Ionicons name="receipt-outline" size={24} color={colors.textMuted} /><Text style={{ ...type.body, color: colors.textMuted }}>No invoices or payments recorded yet.</Text></View> : null}
    </View>
  );
}
