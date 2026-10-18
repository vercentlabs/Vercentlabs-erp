import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
export type CrmHoliday = { id: string; date: string; name: string };
export function listHolidays(client: QueryClient, context: CrmContext, options?: { year?: number | null }): Promise<CrmHoliday[]>;
export function addHoliday(client: QueryClient, context: CrmContext, input: { date: string; name: string }): Promise<CrmHoliday>;
export function removeHoliday(client: QueryClient, context: CrmContext, holidayId: string): Promise<{ removed: true }>;
export function addNationalHolidays(client: QueryClient, context: CrmContext, year: number): Promise<{ added: number; holidays: CrmHoliday[] }>;
