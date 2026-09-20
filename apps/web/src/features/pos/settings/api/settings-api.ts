"use client";

import type { PosSettings, PosSettingsValues } from "@vercentlabs/api";

import { request } from "@/features/pos/shared/http";

export type { PosSettings, PosSettingsValues };

export const getPosSettings = () => request<PosSettings>("/settings");

// PUT, not POST: this replaces the named settings on the company's single
// settings row (a partial body only changes the named fields).
export const updatePosSettings = (input: Partial<{ [K in keyof PosSettingsValues]: PosSettingsValues[K] extends string ? string | number : PosSettingsValues[K] }>) =>
  request<PosSettings>("/settings", { method: "PUT", body: JSON.stringify(input) });
