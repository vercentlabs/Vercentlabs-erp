import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
export type CrmHoliday = { id: string; date: string; name: string };
export function listHolidays(client: QueryClient, context: CrmContext, options?: { year?: number | null }): Promise<CrmHoliday[]>;
export function addHoliday(client: QueryClient, context: CrmContext, input: { date: string; name: string }): Promise<CrmHoliday>;
export function removeHoliday(client: QueryClient, context: CrmContext, holidayId: string): Promise<{ removed: true }>;
export const NATIONAL_HOLIDAYS: ReadonlyArray<readonly [string, string]>;
// Holiday presets by state (CRM audit).
export type CrmHolidayPreset = { date: string; name: string; check: boolean };
export const HOLIDAY_PRESET_YEARS: readonly number[];
export function holidayPresets(year: number, state?: string | null): CrmHolidayPreset[];
export function addPresetHolidays(client: QueryClient, context: CrmContext, input: { year: number; state?: string | null; dates?: string[] }): Promise<{ added: number; holidays: CrmHoliday[] }>;
