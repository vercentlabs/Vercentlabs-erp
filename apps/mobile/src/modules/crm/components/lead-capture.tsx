import * as Crypto from "expo-crypto";
import { useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { mobileApi } from "@/core/api/client";
import { enqueueMutation } from "@/core/database/database";
import { useTheme } from "@/shared/theme/theme";
import { Button } from "@/shared/components/button";
import { Screen } from "@/shared/components/screen";

export function LeadCapture() {
  const [open, setOpen] = useState(false); const [firstName, setFirstName] = useState(""); const [lastName, setLastName] = useState(""); const [email, setEmail] = useState(""); const [companyName, setCompanyName] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const { colors, radii, spacing, type } = useTheme();
  async function submit() {
    if (!firstName.trim()) { setMessage("First name is required."); return; }
    setBusy(true); setMessage("");
    const idempotencyKey = Crypto.randomUUID();
    const payload = { firstName: firstName.trim(), lastName: lastName.trim() || null, email: email.trim() || null, companyName: companyName.trim() || null };
    try {
      await mobileApi.createCrm("leads", payload, idempotencyKey);
      setMessage("Lead saved securely."); void queryClient.invalidateQueries({ queryKey: ["mobile-crm"] });
      setTimeout(() => { setOpen(false); setMessage(""); setFirstName(""); setLastName(""); setEmail(""); setCompanyName(""); }, 500);
    } catch (error) {
      if ((error as { retryable?: boolean }).retryable !== false) {
        await enqueueMutation({ id: Crypto.randomUUID(), operation: "create", resource: "leads", payload, idempotencyKey });
        setMessage("Saved offline. We’ll sync this lead automatically.");
      } else setMessage(error instanceof Error ? error.message : "Lead could not be saved.");
    } finally { setBusy(false); }
  }
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Create lead" onPress={() => setOpen(true)} style={{ minHeight: 48, justifyContent: "center", alignItems: "center", borderRadius: radii.full, backgroundColor: colors.primary, marginBottom: spacing.lg }}><Text style={{ ...type.label, color: colors.inverse }}>+ New lead</Text></Pressable>
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
      <Screen keyboardShouldPersistTaps="handled"><View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.xl }}><Text accessibilityRole="header" style={{ ...type.title, color: colors.text, flex: 1 }}>New lead</Text><Pressable accessibilityRole="button" onPress={() => setOpen(false)}><Text style={{ ...type.label, color: colors.primary }}>Cancel</Text></Pressable></View>
        <View style={{ gap: spacing.md }}>{[["First name", firstName, setFirstName], ["Last name", lastName, setLastName], ["Work email", email, setEmail], ["Company", companyName, setCompanyName]].map(([label, value, setter]) => <View key={label as string} style={{ gap: spacing.xs }}><Text style={{ ...type.label, color: colors.text }}>{label as string}</Text><TextInput value={value as string} onChangeText={setter as (value: string) => void} autoCapitalize={label === "Work email" ? "none" : "words"} keyboardType={label === "Work email" ? "email-address" : "default"} style={{ minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, ...type.body, color: colors.text, backgroundColor: colors.surface }} /></View>)}
          {message ? <Text accessibilityRole="alert" style={{ ...type.body, color: message.includes("could not") || message.includes("required") ? colors.danger : colors.success }}>{message}</Text> : null}
          <Button label={busy ? "Saving…" : "Save lead"} disabled={busy} onPress={() => void submit()} />
        </View>
      </Screen>
    </Modal>
  </>;
}
