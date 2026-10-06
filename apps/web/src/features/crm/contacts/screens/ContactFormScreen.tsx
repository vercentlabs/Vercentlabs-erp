"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, ErrorState, MultiSelect, RecordFormPage, Select, TextArea, TextField } from "@vercentlabs/design-system";

import { AccountPicker } from "@/features/crm/accounts/components/AccountPicker";
import { CountrySelect } from "@/features/crm/shared/ui/CountrySelect";
import { FormSection } from "@/features/crm/shared/ui/FormSection";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import {
  checkContactDuplicates, createContact, duplicateMatchesOf, errorMessage, getContact, getContactOptions, updateContact,
  type Contact, type ContactDuplicateMatch, type ContactOptions,
} from "../api/contacts-api";
import { DuplicateOverride } from "@/features/crm/duplicates/DuplicateParts";
import { ContactDuplicateWarning } from "../components/ContactDuplicateWarning";
import { ErrorBanner } from "../contact-format";
import { useSubmitKey } from "@/shared/http/submit-once";

const NONE = "";
const AUTO = "__auto__";
const UNASSIGNED = "__unassigned__";

type FormValues = {
  firstName: string; middleName: string; lastName: string; displayName: string; jobTitle: string; department: string; role: string; isDecisionMaker: boolean;
  email: string; secondaryEmail: string; phone: string; mobile: string; alternatePhone: string; preferredContactMethod: string;
  doNotEmail: boolean; doNotCall: boolean; doNotSms: boolean; marketingConsent: string;
  useAccountAddress: boolean; addressLine1: string; addressLine2: string; city: string; state: string; postalCode: string; countryCode: string;
  sourceId: string; description: string; tagIds: string[]; accountId: string | null; makePrimary: boolean; ownerUserId: string; teamId: string;
};

const EMPTY: FormValues = {
  firstName: "", middleName: "", lastName: "", displayName: "", jobTitle: "", department: "", role: NONE, isDecisionMaker: false,
  email: "", secondaryEmail: "", phone: "", mobile: "", alternatePhone: "", preferredContactMethod: NONE,
  doNotEmail: false, doNotCall: false, doNotSms: false, marketingConsent: "unknown",
  useAccountAddress: true, addressLine1: "", addressLine2: "", city: "", state: "", postalCode: "", countryCode: "",
  sourceId: NONE, description: "", tagIds: [], accountId: null, makePrimary: false, ownerUserId: AUTO, teamId: NONE,
};

function valuesFromContact(contact: Contact): FormValues {
  return {
    ...EMPTY,
    firstName: contact.firstName, middleName: contact.middleName ?? "", lastName: contact.lastName ?? "", displayName: contact.displayName,
    jobTitle: contact.jobTitle ?? "", department: contact.department ?? "", role: contact.role ?? NONE, isDecisionMaker: contact.isDecisionMaker,
    email: contact.email ?? "", secondaryEmail: contact.secondaryEmail ?? "", phone: contact.phone ?? "", mobile: contact.mobile ?? "",
    alternatePhone: contact.alternatePhone ?? "", preferredContactMethod: contact.preferredContactMethod ?? NONE,
    doNotEmail: contact.doNotEmail, doNotCall: contact.doNotCall, doNotSms: contact.doNotSms, marketingConsent: contact.marketingConsent,
    useAccountAddress: contact.useAccountAddress, addressLine1: contact.addressLine1 ?? "", addressLine2: contact.addressLine2 ?? "", city: contact.city ?? "",
    state: contact.state ?? "", postalCode: contact.postalCode ?? "", countryCode: contact.countryCode ?? "",
    sourceId: contact.sourceId ?? NONE, description: contact.description ?? "", tagIds: contact.tags.map((tag) => tag.id),
  };
}

const COMMUNICATION_FIELDS = ["email", "secondaryEmail", "phone", "mobile", "alternatePhone"] as const;

// Company, owner and team are set here only when creating; afterwards they
// change from the contact page so each change is recorded.
function toInput(values: FormValues, mode: "create" | "edit", sensitiveHidden: boolean, original?: Contact) {
  const { accountId, makePrimary, ownerUserId, teamId, displayName, ...fields } = values;
  const input: Record<string, unknown> = {
    ...fields,
    role: fields.role || null,
    preferredContactMethod: fields.preferredContactMethod || null,
    sourceId: fields.sourceId || null,
  };
  // A display name left as the automatic one follows the name fields.
  const automatic = [fields.firstName, fields.middleName, fields.lastName].map((part) => part.trim()).filter(Boolean).join(" ");
  if (displayName.trim() && displayName.trim() !== automatic && displayName.trim() !== original?.displayName) input.displayName = displayName.trim();
  if (sensitiveHidden) for (const field of COMMUNICATION_FIELDS) delete input[field];
  if (mode === "create") {
    if (accountId) { input.accountId = accountId; input.makePrimary = makePrimary; }
    if (ownerUserId !== AUTO) input.ownerUserId = ownerUserId === UNASSIGNED ? null : ownerUserId;
    if (teamId) input.teamId = teamId;
  }
  return input;
}

export function ContactFormScreen({ contactId, initialAccountId }: { contactId?: string; initialAccountId?: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const optionsQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "contact-options"), queryFn: getContactOptions, staleTime: 60_000 });
  const contactQuery = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "contact", contactId), queryFn: () => getContact(contactId as string), enabled: Boolean(contactId) });
  const contact = contactQuery.data;

  if (optionsQuery.isLoading || (contactId && contactQuery.isLoading)) return <LoadingState label={contactId ? "Loading contact" : "Loading"} />;
  if (contactId && (contactQuery.isError || !contact))
    return <ErrorState title="Could not load this contact" description={errorMessage(contactQuery.error)} action={{ label: "Back to contacts", onPress: () => router.push("/crm/contacts") }} />;
  if (!optionsQuery.data) return <ErrorState title="Could not load this page" description="Refresh to try again." />;
  if (contact?.status === "archived")
    return <ErrorState title="This contact is archived" description="Reactivate it before editing." action={{ label: "Open contact", onPress: () => router.push(`/crm/contacts/${contact.id}`) }} />;
  return <ContactForm key={contact?.id ?? "new"} contact={contact} options={optionsQuery.data} initialAccountId={initialAccountId} />;
}

function ContactForm({ contact, options, initialAccountId }: { contact?: Contact; options: ContactOptions; initialAccountId?: string }) {
  const mode = contact ? "edit" : "create";
  const contactId = contact?.id;
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<FormValues>(() => (contact ? valuesFromContact(contact) : { ...EMPTY, accountId: initialAccountId ?? null }));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [blockingMatches, setBlockingMatches] = useState<ContactDuplicateMatch[] | null>(null);
  const [duplicateReason, setDuplicateReason] = useState("");
  const [liveMatches, setLiveMatches] = useState<ContactDuplicateMatch[]>([]);
  const sensitiveHidden = Boolean(contact?.sensitiveDataRestricted);

  // Warn about likely duplicates while the identifying fields are typed.
  const identity = [values.firstName, values.lastName, values.email, values.secondaryEmail, values.phone, values.mobile, values.alternatePhone, values.accountId].join("|");
  const canCheckDuplicates = Boolean(values.email || values.mobile || values.phone || values.secondaryEmail || values.alternatePhone || values.firstName.trim().length >= 2);
  const similarMatches = canCheckDuplicates ? liveMatches : [];
  useEffect(() => {
    if (!canCheckDuplicates) return;
    const timer = setTimeout(() => {
      checkContactDuplicates({
        firstName: values.firstName, lastName: values.lastName, email: values.email, secondaryEmail: values.secondaryEmail, phone: values.phone,
        mobile: values.mobile, alternatePhone: values.alternatePhone, accountId: values.accountId ?? contact?.accountId ?? undefined, excludeId: contactId,
      }).then((result) => setLiveMatches(result.matches)).catch(() => setLiveMatches([]));
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `identity` stands for the fields read above
  }, [identity, contactId, canCheckDuplicates]);

  const set = <K extends keyof FormValues>(key: K) => (value: FormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  };

  const submit = useSubmitKey();
  const mutation = useMutation({
    mutationFn: (allowDuplicate: boolean) => submit.run(async () => {
      const input = { ...toInput(values, mode, sensitiveHidden, contact), allowDuplicate, ...(allowDuplicate ? { duplicateReason } : {}) };
      return mode === "edit" ? updateContact(contactId as string, { ...input, expectedUpdatedAt: contact?.updatedAt }) : createContact(input);
    }),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "contacts") });
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "contact", saved.id) });
      void queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "account") });
      router.replace(`/crm/contacts/${saved.id}`);
    },
    onError: (failure) => {
      const matches = duplicateMatchesOf(failure);
      if (matches) {
        setBlockingMatches(matches);
        setError(null);
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      const issues = (failure as { details?: { issues?: Array<{ field: string; message: string }> } }).details?.issues ?? [];
      setFieldErrors(Object.fromEntries(issues.map((issue) => [issue.field, issue.message])));
      setError(errorMessage(failure));
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  });

  const reachable = sensitiveHidden || Boolean(values.email.trim() || values.mobile.trim() || values.phone.trim());
  const cancelHref = mode === "edit" ? `/crm/contacts/${contactId}` : initialAccountId ? `/crm/accounts/${initialAccountId}` : "/crm/contacts";
  const roleOptions = [{ value: NONE, label: "Not set" }, ...options.roles.map((entry) => ({ value: entry.code, label: entry.label }))];

  return (
    <RecordFormPage
      header={{
        title: mode === "edit" ? `Edit ${contact?.displayName ?? "contact"}` : "New contact",
        description: mode === "edit" ? contact?.contactNumber ?? undefined : "A first name and a way to reach the person are enough to start. The company is optional.",
      }}
      banner={
        <div className="flex flex-col gap-3">
          <ErrorBanner message={error} />
          {blockingMatches ? (
            <ContactDuplicateWarning matches={blockingMatches} blocking>
              <DuplicateOverride subject="person" reason={duplicateReason} onReasonChange={setDuplicateReason}
                onConfirm={() => mutation.mutate(true)} onCancel={() => setBlockingMatches(null)} isLoading={mutation.isPending || mutation.isSuccess} />
            </ContactDuplicateWarning>
          ) : (
            <ContactDuplicateWarning matches={similarMatches} blocking={similarMatches.some((match) => match.strength === "exact")} />
          )}
        </div>
      }
      formActions={
        <>
          <Button variant="secondary" onPress={() => router.replace(cancelHref)}>Cancel</Button>
          <Button variant="primary" onPress={() => mutation.mutate(false)} isLoading={mutation.isPending || mutation.isSuccess} isDisabled={!values.firstName.trim() || !reachable}>
            {mode === "edit" ? "Save changes" : "Create contact"}
          </Button>
        </>
      }
    >
      <FormSection title="Person">
        <TextField label="First name" isRequired value={values.firstName} onChange={set("firstName")} errorMessage={fieldErrors.firstName} />
        <TextField label="Middle name" value={values.middleName} onChange={set("middleName")} />
        <TextField label="Last name" value={values.lastName} onChange={set("lastName")} errorMessage={fieldErrors.lastName} />
        <TextField label="Display name" description="Leave empty to use the full name." value={values.displayName} onChange={set("displayName")} />
      </FormSection>

      {mode === "create" && (
        <FormSection title="Company" description="Optional. A person can be linked to more companies later.">
          <AccountPicker label="Company" value={values.accountId} onChange={(id) => set("accountId")(id)} />
          {values.accountId && <Checkbox isSelected={values.makePrimary} onChange={set("makePrimary")}>Primary contact for this company</Checkbox>}
        </FormSection>
      )}

      <FormSection title="Position" description={contact?.accountName ? `At ${contact.accountName}.` : undefined}>
        <TextField label="Job title" value={values.jobTitle} onChange={set("jobTitle")} />
        <TextField label="Department" value={values.department} onChange={set("department")} />
        <Select label="Role" description="Who this person is in the buying process." selectedKey={values.role} onSelectionChange={(key) => set("role")(String(key ?? NONE))} options={roleOptions} />
        <Checkbox isSelected={values.isDecisionMaker} onChange={set("isDecisionMaker")}>Decision maker</Checkbox>
      </FormSection>

      {!sensitiveHidden && (
        <FormSection title="Contact details" description="At least a work email, mobile or work phone.">
          <TextField label="Work email" type="email" value={values.email} onChange={set("email")} errorMessage={fieldErrors.email} />
          <TextField label="Secondary email" type="email" value={values.secondaryEmail} onChange={set("secondaryEmail")} errorMessage={fieldErrors.secondaryEmail} />
          <TextField label="Mobile" type="tel" value={values.mobile} onChange={set("mobile")} errorMessage={fieldErrors.mobile} />
          <TextField label="Work phone" type="tel" value={values.phone} onChange={set("phone")} errorMessage={fieldErrors.phone} />
          <TextField label="Alternate phone" type="tel" value={values.alternatePhone} onChange={set("alternatePhone")} errorMessage={fieldErrors.alternatePhone} />
          <Select label="Preferred contact method" selectedKey={values.preferredContactMethod} onSelectionChange={(key) => set("preferredContactMethod")(String(key ?? NONE))}
            options={[{ value: NONE, label: "Not set" }, ...options.preferredContactMethods.map((entry) => ({ value: entry.code, label: entry.label }))]} />
        </FormSection>
      )}

      <FormSection title="Communication preferences">
        <Checkbox isSelected={values.doNotEmail} onChange={set("doNotEmail")}>Do not email</Checkbox>
        <Checkbox isSelected={values.doNotCall} onChange={set("doNotCall")}>Do not call</Checkbox>
        <Checkbox isSelected={values.doNotSms} onChange={set("doNotSms")}>Do not SMS</Checkbox>
        <Select label="Marketing" selectedKey={values.marketingConsent} onSelectionChange={(key) => set("marketingConsent")(String(key))}
          options={options.marketingConsent.map((entry) => ({ value: entry.code, label: entry.label }))} />
      </FormSection>

      <FormSection title="Address">
        <Checkbox isSelected={values.useAccountAddress} onChange={set("useAccountAddress")}>Use the company address</Checkbox>
        <span className="hidden sm:block" />
        {!values.useAccountAddress && (
          <>
            <TextField label="Address line 1" className="sm:col-span-2" value={values.addressLine1} onChange={set("addressLine1")} />
            <TextField label="Address line 2" className="sm:col-span-2" value={values.addressLine2} onChange={set("addressLine2")} />
            <TextField label="City" value={values.city} onChange={set("city")} />
            <TextField label="State" value={values.state} onChange={set("state")} />
            <TextField label="Postal code" value={values.postalCode} onChange={set("postalCode")} />
            <CountrySelect value={values.countryCode} onChange={set("countryCode")} errorMessage={fieldErrors.countryCode} />
          </>
        )}
      </FormSection>

      <FormSection title="Source and notes">
        <Select label="Source" selectedKey={values.sourceId} onSelectionChange={(key) => set("sourceId")(String(key ?? NONE))}
          options={[{ value: NONE, label: "Not set" }, ...options.sources.filter((source) => source.isActive || source.id === values.sourceId).map((source) => ({ value: source.id, label: source.name }))]} />
        <MultiSelect label="Tags" placeholder={options.tags.length ? "Choose tags" : "No tags have been set up"}
          value={values.tagIds} onChange={set("tagIds")} options={options.tags.map((tag) => ({ value: tag.id, label: tag.name }))} />
        <TextArea label="Description" className="sm:col-span-2" value={values.description} onChange={set("description")} />
      </FormSection>

      {mode === "create" && (
        <FormSection title="Ownership" description="Left on automatic, the company's owner owns the contact; without a company, you do.">
          <Select label="Contact owner" selectedKey={values.ownerUserId} onSelectionChange={(key) => set("ownerUserId")(String(key))}
            options={[
              { value: AUTO, label: "Automatic" },
              { value: UNASSIGNED, label: "Leave unassigned" },
              ...options.users.filter((user) => options.capabilities.assign || user.id === options.currentUserId)
                .map((user) => ({ value: user.id, label: user.id === options.currentUserId ? `${user.name} (me)` : user.name })),
            ]} />
          <Select label="Sales team" selectedKey={values.teamId} onSelectionChange={(key) => set("teamId")(String(key ?? NONE))}
            options={[{ value: NONE, label: "No team" }, ...options.teams.map((team) => ({ value: team.id, label: team.name }))]} />
        </FormSection>
      )}
    </RecordFormPage>
  );
}
