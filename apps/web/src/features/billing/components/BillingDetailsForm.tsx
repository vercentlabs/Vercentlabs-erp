"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, TextField } from "@vercentlabs/design-system";

import { saveProfile, type Overview } from "../api/billing-api";
import { BillingPanel } from "./BillingPanel";

export function BillingDetailsForm({ overview, onResult }: { overview: Overview; onResult: (report: { tone: "success" | "danger"; text: string }) => void }) {
  const p = overview.profile;
  const [form, setForm] = useState({
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
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const save = useMutation({
    mutationFn: () => saveProfile(form),
    onSuccess: () => onResult({ tone: "success", text: "Billing details saved." }),
    onError: (error) => onResult({ tone: "danger", text: error instanceof Error ? error.message : "Billing details could not be saved." }),
  });
  return (
    <BillingPanel title="Billing details" description="Used for your subscription and payment records. GSTIN is optional.">
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
      <div className="flex justify-end">
        <Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>
          Save billing details
        </Button>
      </div>
    </BillingPanel>
  );
}
