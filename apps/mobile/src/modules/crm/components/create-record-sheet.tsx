import * as Crypto from "expo-crypto";
import { useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { mobileApi } from "@/core/api/client";
import { enqueueMutation } from "@/core/database/database";
import { useTheme } from "@/shared/theme/theme";
import { Button } from "@/shared/components/button";
import { Screen } from "@/shared/components/screen";

type Resource = "opportunities" | "activities";
type Field = readonly [string, string, boolean];
const definitions: Record<Resource, { label: string; fields: readonly Field[] }> = {
  opportunities: { label: "opportunity", fields: [["name", "Opportunity name", true], ["estimatedValue", "Estimated value", false], ["expectedCloseDate", "Expected close date (YYYY-MM-DD)", false]] },
  activities: { label: "activity", fields: [["subject", "Subject", true], ["activityType", "Type (call, meeting, task)", true], ["dueAt", "Due date and time", false], ["description", "Notes", false]] },
};
const callFields: readonly Field[] = [["direction", "Call direction (inbound or outbound)", true], ["phoneNumber", "Phone number", true]];
const meetingFields: readonly Field[] = [
  ["startAt", "Meeting start date and time", true],
  ["endAt", "Meeting end date and time", true],
  ["locationType", "Location type (in_person, online, phone, other)", true],
  ["location", "Location", false],
  ["meetingUrl", "Meeting URL", false],
];

export function CreateRecordSheet({ resource }: { resource: Resource }) {
  const definition = definitions[resource];
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();
  const { colors, radii, spacing, type } = useTheme();
  const isCall = resource === "activities" && values.activityType?.trim().toLowerCase() === "call";
  const isMeeting = resource === "activities" && values.activityType?.trim().toLowerCase() === "meeting";
  const activityBaseFields = definition.fields.filter(([key]) => !isMeeting || key !== "dueAt");
  const fields = isCall ? [...definition.fields, ...callFields] : isMeeting ? [...activityBaseFields, ...meetingFields] : [...definition.fields];

  async function submit() {
    const missing = fields.find(([key, , required]) => required && !values[key]?.trim());
    if (missing) { setMessage(`${missing[1]} is required.`); return; }
    if (isCall && !values.dueAt?.trim()) { setMessage("Due date and time is required for a scheduled Call."); return; }
    if (isMeeting && values.locationType?.trim().toLowerCase() === "in_person" && !values.location?.trim()) { setMessage("Location is required for an in-person Meeting."); return; }
    if (isMeeting && values.locationType?.trim().toLowerCase() === "online" && !values.meetingUrl?.trim()) { setMessage("Meeting URL is required for an online Meeting."); return; }
    setBusy(true); setMessage("");
    const idempotencyKey = Crypto.randomUUID();
    const payload = Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim()).map(([key, value]) => [key, key === "estimatedValue" ? Number(value) : value.trim()]));
    try {
      if (isCall) await mobileApi.createCall({ ...payload, mode: "schedule" }, idempotencyKey);
      else if (isMeeting) await mobileApi.createMeeting({ ...payload, mode: "schedule" }, idempotencyKey);
      else await mobileApi.createCrm(resource, payload, idempotencyKey);
      await queryClient.invalidateQueries({ queryKey: ["mobile-crm"] });
      setOpen(false); setValues({});
    } catch (error) {
      if ((error as { retryable?: boolean }).retryable !== false) {
        await enqueueMutation({ id: Crypto.randomUUID(), operation: isCall ? "create-call" : isMeeting ? "create-meeting" : "create", resource, payload: isCall || isMeeting ? { ...payload, mode: "schedule" } : payload, idempotencyKey });
        setMessage(`Saved offline. This ${isCall ? "Call" : isMeeting ? "Meeting" : definition.label} will sync automatically.`);
      } else setMessage(error instanceof Error ? error.message : "Could not save the record.");
    } finally { setBusy(false); }
  }

  return <>
    <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={{ minHeight: 48, paddingHorizontal: spacing.lg, justifyContent: "center", alignItems: "center", borderRadius: radii.full, backgroundColor: colors.primary }}><Text style={{ ...type.label, color: colors.inverse }}>New {definition.label}</Text></Pressable>
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}><Screen keyboardShouldPersistTaps="handled"><View style={{ flexDirection: "row", alignItems: "center", marginBottom: spacing.xl }}><Text accessibilityRole="header" style={{ ...type.title, color: colors.text, flex: 1 }}>New {isCall ? "Call" : isMeeting ? "Meeting" : definition.label}</Text><Pressable accessibilityRole="button" onPress={() => setOpen(false)}><Text style={{ ...type.label, color: colors.primary }}>Cancel</Text></Pressable></View><View style={{ gap: spacing.md }}>{fields.map(([key, label]) => <View key={key} style={{ gap: spacing.xs }}><Text style={{ ...type.label, color: colors.text }}>{label}</Text><TextInput accessibilityLabel={label} value={values[key] ?? ""} onChangeText={(value) => setValues((current) => ({ ...current, [key]: value }))} keyboardType={key === "estimatedValue" ? "numeric" : key === "phoneNumber" ? "phone-pad" : "default"} multiline={key === "description"} style={{ minHeight: key === "description" ? 96 : 52, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md, ...type.body, color: colors.text, backgroundColor: colors.surface }} /></View>)}{isCall ? <Text style={{ ...type.caption, color: colors.textMuted }}>Calls use the device dialer only. No telephony provider or recording is implied.</Text> : null}{isMeeting ? <Text style={{ ...type.caption, color: colors.textMuted }}>Meetings are scheduled and tracked in CRM. Public booking links and synced calendars remain connected through the calendar workflow.</Text> : null}{message ? <Text accessibilityRole="alert" style={{ ...type.body, color: message.includes("required") || message.includes("Could") ? colors.danger : colors.success }}>{message}</Text> : null}<Button label={busy ? "Saving…" : `Save ${isCall ? "Call" : isMeeting ? "Meeting" : definition.label}`} disabled={busy} onPress={() => void submit()} /></View></Screen></Modal>
  </>;
}
