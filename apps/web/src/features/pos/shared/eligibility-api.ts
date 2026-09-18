"use client";

import { request } from "@/features/pos/shared/http";

// Item-group search for promotion eligibility pickers (see
// EligibilitySearchPicker.tsx). Item and customer search already exist
// (checkout-api.ts's searchPosProducts/searchPosCustomers) and are reused
// directly -- this is the one genuinely new, minimal search endpoint
// needed to close the item-group half of the picker gap.
export type PosItemGroupMatch = { id: string; code: string; name: string };
export const searchPosItemGroups = (query: string) => request<{ rows: PosItemGroupMatch[] }>(`/item-groups?q=${encodeURIComponent(query)}`);
