"use client";

// The company's billing details (legal name, email, GSTIN, address) — what Vercentlabs' GST tax invoices are made out to. Shown as a
// summary with Edit; the form opens only to add or change them.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Building2, Mail, MapPin, Pencil, Phone, Receipt } from "lucide-react";
import { Button, TextField } from "@vercentlabs/design-system";

import { saveProfile, type Overview } from "../api/billing-api";
import { BillingPanel } from "./BillingPanel";

type Profile = NonNullable<Overview["profile"]>;

const fromProfile = (p: Overview["profile"]) => ({
  legalName: p?.legal_name ?? "",
  billingEmail: p?.billing_email ?? "",
  phone: p?.phone ?? "",
  gstin: p?.gstin ?? "",
  addressLine1: p?.address_line1 ?? "",
  addressLine2: p?.address_line2 ?? "",
  city: p?.city ?? "",
  state: p?.state ?? "",
  postalCode: p?.postal_code ?? "",
  country: p?.country_code ?? "IN",
});

export function BillingDetailsForm({
  overview,
  onResult,
}: {
  overview: Overview;
  onResult: (report: { tone: "success" | "danger"; text: string }) => void;
}) {
  const p = overview.profile;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(() => fromProfile(p));
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const save = useMutation({
    mutationFn: () => saveProfile(form),
    onSuccess: () => {
      setEditing(false);
      onResult({ tone: "success", text: "Billing details saved." });
    },
    onError: (error) =>
      onResult({
        tone: "danger",
        text:
          error instanceof Error
            ? error.message
            : "Billing details could not be saved.",
      }),
  });
  const open = () => { setForm(fromProfile(p)); setEditing(true); };

  if (!editing) {
    return (
      <BillingPanel
        title="Billing details"
        description="Who Vercentlabs' GST tax invoices are made out to."
      >
        {p ? (
          <div className="flex flex-wrap items-start justify-between gap-4">
            <ProfileSummary profile={p} />
            <Button variant="outline" size="compact" onPress={open}>
              <Pencil className="size-4" aria-hidden="true" />Edit
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-dashed border-border-strong px-4 py-3">
            <p className="text-sm text-text-secondary">
              {overview.subscription.trial
                ? "Not needed during your trial. Add them when you subscribe; they appear on your GST invoices."
                : "No billing details yet. Add them before you subscribe; they appear on your GST invoices."}
            </p>
            <Button variant="secondary" size="compact" onPress={open}>Add billing details</Button>
          </div>
        )}
      </BillingPanel>
    );
  }

  return (
    <BillingPanel
      title="Billing details"
      description="Used for your subscription and payment records. GSTIN is optional."
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField label="Legal name" isRequired value={form.legalName} onChange={set("legalName")} />
        <TextField label="Billing email" isRequired type="email" value={form.billingEmail} onChange={set("billingEmail")} />
        <TextField label="Phone" value={form.phone} onChange={set("phone")} />
        <TextField label="GSTIN" description="Only if your business is GST-registered." value={form.gstin} onChange={set("gstin")} />
        <TextField label="Address" isRequired value={form.addressLine1} onChange={set("addressLine1")} />
        <TextField label="Address line 2" value={form.addressLine2} onChange={set("addressLine2")} />
        <TextField label="City" isRequired value={form.city} onChange={set("city")} />
        <TextField label="State" isRequired value={form.state} onChange={set("state")} />
        <TextField label="Postal code" isRequired value={form.postalCode} onChange={set("postalCode")} />
        <TextField label="Country code" isRequired value={form.country} onChange={(value) => set("country")(value.toUpperCase().slice(0, 2))} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onPress={() => setEditing(false)} isDisabled={save.isPending}>Cancel</Button>
        <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save billing details</Button>
      </div>
    </BillingPanel>
  );
}

function ProfileSummary({ profile: p }: { profile: Profile }) {
  const address = [p.address_line1, p.address_line2, [p.city, p.state].filter(Boolean).join(", "), [p.postal_code, p.country_code].filter(Boolean).join(" ")]
    .filter(Boolean).join(", ");
  const rows = [
    { icon: Building2, value: p.legal_name, strong: true },
    { icon: Mail, value: p.billing_email },
    { icon: Phone, value: p.phone },
    { icon: Receipt, value: p.gstin ? `GSTIN ${p.gstin}` : "Not GST-registered" },
    { icon: MapPin, value: address },
  ].filter((row) => row.value);
  return (
    <ul className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
      {rows.map(({ icon: Icon, value, strong }) => (
        <li key={String(value)} className={`flex items-start gap-2 ${strong ? "font-semibold text-text" : "text-text-secondary"}`}>
          <Icon className="mt-0.5 size-4 shrink-0 text-text-muted" aria-hidden="true" />{value}
        </li>
      ))}
    </ul>
  );
}
