"use client";

import { request } from "@/features/pos/shared/http";

// The terminals a POS screen picks from (checkout, shifts, reports), filtered server-side to the outlets the person may work at. Terminals
// themselves are maintained in POS Terminals (features/pos/terminals).
export type PosTerminal = {
  id: string;
  code: string;
  name: string;
  storeId?: string;
  store_id?: string;
  store_name?: string | null;
  status: string;
};

export const listPosTerminals = () => request<{ rows: PosTerminal[] }>("/terminals/picker?limit=200");
