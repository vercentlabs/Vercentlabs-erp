"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, MultiSelect, PermissionState, RecordFormPage, Select, TextArea, TextField, type SelectOption } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { listContacts } from "@/features/crm/contacts/api/contacts-api";
import { createMeeting, MeetingApiError } from "../api/meetings-api";

type FormValues = {
  mode: "schedule" | "log";
  subject: string;
  description: string;
  locationType: "in_person" | "online" | "phone" | "other";
  location: string;
  meetingUrl: string;
  startAt: string;
  endAt: string;
  occurredAt: string;
  durationMinutes: number | null;
  outcomeCode: string;
  contactAttendeeIds: string[];
  attendeesText: string;
};

const EMPTY: FormValues = {
  mode: "schedule",
  subject: "",
  description: "",
  locationType: "online",
  location: "",
  meetingUrl: "",
  startAt: "",
  endAt: "",
  occurredAt: "",
  durationMinutes: null,
  outcomeCode: "held",
  contactAttendeeIds: [],
  attendeesText: "",
};

// F014 Stage A2 §5 closeout: replaces the prior plain-text-only attendee
// entry with a real Contact picker (contactId per crm_activity_attendees
// — normalizeAttendees in meeting-operations.js already resolves and
// validates it). Free-text email entry is kept alongside it for external
// guests who aren't a CRM Contact, not removed — both are real, distinct
// attendee sources, not a fallback for one being unbuilt.
function parseExternalAttendees(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((email) => ({ email, name: email }));
}

export function MeetingFormScreen({ canManage = true }: { canManage?: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  const contactsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "contacts", "meeting-attendee-candidates"),
    queryFn: () => listContacts({ status: "active", limit: 200 }),
  });
  const contactsById = useMemo(() => new Map((contactsQuery.data?.rows ?? []).map((row) => [row.id, row])), [contactsQuery.data]);
  const contactOptions: SelectOption[] = useMemo(
    () => (contactsQuery.data?.rows ?? []).map((row) => ({ value: row.id, label: [row.firstName, row.lastName].filter(Boolean).join(" ") || row.email || row.id })),
    [contactsQuery.data],
  );

  const mutation = useMutation({
    mutationFn: async () => {
      if (!values.subject.trim()) {
        setFieldErrors({ subject: "Subject is required." });
        throw new Error("Review the highlighted fields.");
      }
      setFieldErrors({});
      const input: Record<string, unknown> = {
        entityType: "general",
        mode: values.mode,
        subject: values.subject,
        description: values.description || null,
        locationType: values.locationType,
        location: values.location || null,
        meetingUrl: values.meetingUrl || null,
        attendees: [
          ...values.contactAttendeeIds.map((contactId) => {
            const contact = contactsById.get(contactId);
            return { contactId, name: contact ? [contact.firstName, contact.lastName].filter(Boolean).join(" ") : null };
          }),
          ...parseExternalAttendees(values.attendeesText),
        ],
      };
      if (values.mode === "schedule") {
        input.startAt = values.startAt || null;
        input.endAt = values.endAt || null;
      } else {
        input.occurredAt = values.occurredAt || new Date().toISOString();
        input.durationMinutes = values.durationMinutes ?? 30;
        input.outcomeCode = values.outcomeCode;
      }
      return createMeeting(input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "meetings") });
      router.push("/crm/meetings");
    },
    onError: (error: Error) => {
      setServerError(error instanceof MeetingApiError ? error.message : error.message);
    },
  });

  if (!canManage) return <PermissionState title="You don't have access to create Meetings" />;

  return (
    <RecordFormPage
      header={{ title: "New meeting", description: "Schedule a meeting for later, or log one that already happened." }}
      banner={
        serverError ? (
          <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
            {serverError}
          </p>
        ) : null
      }
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.back()} isDisabled={mutation.isPending}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate()} isLoading={mutation.isPending}>{values.mode === "schedule" ? "Schedule meeting" : "Log meeting"}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Mode"
          options={[
            { value: "schedule", label: "Schedule for later" },
            { value: "log", label: "Log a completed meeting" },
          ]}
          selectedKey={values.mode}
          onSelectionChange={(key) => set("mode", String(key) as FormValues["mode"])}
          className="sm:col-span-2"
        />
        <TextField label="Subject" isRequired value={values.subject} onChange={(v) => set("subject", v)} errorMessage={fieldErrors.subject} className="sm:col-span-2" />
        <Select
          label="Location type"
          options={[
            { value: "online", label: "Online" },
            { value: "in_person", label: "In person" },
            { value: "phone", label: "Phone" },
            { value: "other", label: "Other" },
          ]}
          selectedKey={values.locationType}
          onSelectionChange={(key) => set("locationType", String(key) as FormValues["locationType"])}
        />
        {values.locationType === "online" ? (
          <TextField label="Meeting URL" value={values.meetingUrl} onChange={(v) => set("meetingUrl", v)} />
        ) : (
          <TextField label="Location" value={values.location} onChange={(v) => set("location", v)} />
        )}
        {values.mode === "schedule" ? (
          <>
            <TextField label="Start at" placeholder="YYYY-MM-DDTHH:mm" value={values.startAt} onChange={(v) => set("startAt", v)} />
            <TextField label="End at" placeholder="YYYY-MM-DDTHH:mm" value={values.endAt} onChange={(v) => set("endAt", v)} />
          </>
        ) : (
          <>
            <TextField label="Occurred at" placeholder="YYYY-MM-DDTHH:mm" value={values.occurredAt} onChange={(v) => set("occurredAt", v)} />
            <Select
              label="Outcome"
              options={[
                { value: "held", label: "Held" },
                { value: "no_show", label: "No-show" },
              ]}
              selectedKey={values.outcomeCode}
              onSelectionChange={(key) => set("outcomeCode", String(key))}
            />
          </>
        )}
      </div>
      <TextArea label="Description" value={values.description} onChange={(v) => set("description", v)} />
      <MultiSelect
        label="Contacts to invite"
        options={contactOptions}
        value={values.contactAttendeeIds}
        onChange={(next) => set("contactAttendeeIds", next)}
      />
      <TextArea
        label="Other attendee emails (one per line)"
        description="For guests who aren't a CRM Contact."
        value={values.attendeesText}
        onChange={(v) => set("attendeesText", v)}
      />
    </RecordFormPage>
  );
}
