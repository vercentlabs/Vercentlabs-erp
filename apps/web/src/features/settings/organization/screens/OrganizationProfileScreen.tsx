"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, PageHeader, PermissionState, Select, TextField } from "@vercentlabs/design-system";

import { getOrganizationProfile, OrganizationApiError, OrganizationProfile, updateOrganizationProfile } from "../api/organization-api";

const PROFILE_QUERY_KEY = ["settings", "organization", "profile"];

const MONTH_OPTIONS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

export function OrganizationProfileScreen({ canManage }: { canManage: boolean }) {
  const query = useQuery({ queryKey: PROFILE_QUERY_KEY, queryFn: getOrganizationProfile });

  if (!canManage) {
    return (
      <div className="flex flex-1 flex-col gap-6 px-8 py-10">
        <PermissionState title="You don't have access to Organization settings" description="Ask an administrator to grant organization.manage." />
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-6 px-8 py-10">
        <p className="text-sm text-text-secondary">Loading…</p>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="flex flex-1 flex-col gap-6 px-8 py-10">
        <ErrorState
          title="Could not load organization profile"
          description={query.error instanceof OrganizationApiError ? query.error.message : "Something went wrong."}
          action={{ label: "Retry", onPress: () => query.refetch() }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 px-8 py-10">
      <PageHeader title="Organization" description="Your organization's name, timezone and fiscal year start." />
      <OrganizationProfileForm profile={query.data.profile} />
    </div>
  );
}

// A separate component, mounted only once the profile has actually
// loaded, so its form state can be initialized directly from real data in
// useState's own initializer — no effect syncing query data into local
// state after the fact (this repo's react-hooks/set-state-in-effect rule
// forbids that pattern; deriving state at mount time via props is the
// correct fix, not a workaround).
function OrganizationProfileForm({ profile }: { profile: OrganizationProfile }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(profile.name);
  const [timezone, setTimezone] = useState(profile.timezone);
  const [fiscalMonth, setFiscalMonth] = useState(String(profile.fiscal_year_start_month));
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: () => updateOrganizationProfile({ name, timezone, fiscalYearStartMonth: Number(fiscalMonth) }),
    onSuccess: (result) => {
      setSaved(true);
      queryClient.setQueryData(PROFILE_QUERY_KEY, result);
    },
    onError: () => setSaved(false),
  });

  return (
    <form
      className="flex max-w-[480px] flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
      noValidate
    >
      <TextField label="Organization name" isRequired value={name} onChange={(value) => { setName(value); setSaved(false); }} />
      <TextField
        label="Timezone"
        isRequired
        value={timezone}
        onChange={(value) => { setTimezone(value); setSaved(false); }}
        description="IANA timezone name, e.g. Asia/Kolkata."
      />
      <Select
        label="Fiscal year start month"
        options={MONTH_OPTIONS}
        selectedKey={fiscalMonth}
        onSelectionChange={(key) => { setFiscalMonth(String(key)); setSaved(false); }}
      />
      {mutation.isError ? (
        <p role="alert" className="text-sm text-danger">
          {mutation.error instanceof OrganizationApiError ? mutation.error.message : "The organization could not be updated."}
        </p>
      ) : null}
      {saved ? <p className="text-sm text-success">Saved.</p> : null}
      <Button type="submit" variant="primary" isLoading={mutation.isPending} className="self-start">
        Save
      </Button>
    </form>
  );
}
