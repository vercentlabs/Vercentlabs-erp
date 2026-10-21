// Holiday presets by state (CRM audit): the national days, the festivals most of India keeps, and a state's own days — Pongal in Tamil
// Nadu, Onam in Kerala, Durga Puja in West Bengal, Gudi Padwa in Maharashtra, its formation day… — for a year, in one step. Festivals
// follow the lunar calendar and their dates are announced each year, so each one that moves is marked to check against the state's
// official list; the person picks what to add, and a date already a holiday is kept.
import { findIndianState } from "@vercentlabs/shared-types";

import { CrmError } from "../data-management/errors.js";
import { listHolidays } from "./records.js";

const MANAGE = "crm.settings.manage";
const ALL = "all";
const NORTH = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "20", "22", "23"];
const HOLI = [...NORTH, "19", "21", "24", "27", "26"];
const SOUTH_NEW_YEAR = ["29", "36", "37"];
const STATE_DAYS = ["03", "06", "22", "23", "29", "32", "37"];

// [date (MM-DD), name, states, moves] — fixed every year.
const FIXED = [
  ["01-26", "Republic Day", [ALL], false],
  ["04-14", "Dr. Ambedkar Jayanti", [ALL], false],
  ["05-01", "Maharashtra Day", ["27"], false],
  ["05-01", "Gujarat Day", ["24"], false],
  ["06-02", "Telangana Formation Day", ["36"], false],
  ["08-15", "Independence Day", [ALL], false],
  ["10-02", "Gandhi Jayanti", [ALL], false],
  ["11-01", "State Formation Day", STATE_DAYS, false],
  ["12-25", "Christmas", [ALL], false],
];

// Festivals by year: [date (YYYY-MM-DD), name, states].
const FESTIVALS = {
  2026: [
    ["2026-01-14", "Makar Sankranti", ["24", "29", "36", "37", "08"]], ["2026-01-13", "Lohri", ["03"]], ["2026-01-15", "Pongal", ["33", "34"]],
    ["2026-03-04", "Holi", HOLI], ["2026-03-19", "Gudi Padwa", ["27", "30"]], ["2026-03-19", "Ugadi", SOUTH_NEW_YEAR],
    ["2026-03-21", "Id-ul-Fitr", [ALL]], ["2026-03-26", "Ram Navami", NORTH], ["2026-03-31", "Mahavir Jayanti", [ALL]], ["2026-04-03", "Good Friday", [ALL]],
    ["2026-04-14", "Vaisakhi", ["03", "06"]], ["2026-04-14", "Tamil New Year", ["33", "34"]], ["2026-04-14", "Bohag Bihu", ["18"]], ["2026-04-15", "Vishu", ["32"]],
    ["2026-04-15", "Bengali New Year", ["19", "16"]], ["2026-05-01", "Buddha Purnima", [ALL]], ["2026-05-27", "Id-ul-Zuha (Bakrid)", [ALL]], ["2026-06-26", "Muharram", [ALL]],
    ["2026-08-26", "Onam", ["32"]], ["2026-08-26", "Milad-un-Nabi", [ALL]], ["2026-09-04", "Janmashtami", [...NORTH, "24", "27"]],
    ["2026-09-14", "Ganesh Chaturthi", ["27", "29", "30", "36", "37", "24"]], ["2026-10-19", "Durga Puja (Maha Navami)", ["19", "16", "18", "21", "20"]],
    ["2026-10-20", "Dussehra", [ALL]], ["2026-11-08", "Diwali", [ALL]], ["2026-11-24", "Guru Nanak Jayanti", [ALL]],
  ],
  2027: [
    ["2027-01-14", "Makar Sankranti", ["24", "29", "36", "37", "08"]], ["2027-01-13", "Lohri", ["03"]], ["2027-01-15", "Pongal", ["33", "34"]],
    ["2027-03-10", "Id-ul-Fitr", [ALL]], ["2027-03-22", "Holi", HOLI], ["2027-03-26", "Good Friday", [ALL]], ["2027-04-07", "Gudi Padwa", ["27", "30"]],
    ["2027-04-07", "Ugadi", SOUTH_NEW_YEAR], ["2027-04-14", "Vaisakhi", ["03", "06"]], ["2027-04-14", "Tamil New Year", ["33", "34"]], ["2027-04-14", "Bohag Bihu", ["18"]],
    ["2027-04-15", "Vishu", ["32"]], ["2027-04-15", "Bengali New Year", ["19", "16"]], ["2027-04-15", "Ram Navami", NORTH], ["2027-04-19", "Mahavir Jayanti", [ALL]],
    ["2027-05-17", "Id-ul-Zuha (Bakrid)", [ALL]], ["2027-05-20", "Buddha Purnima", [ALL]], ["2027-06-15", "Muharram", [ALL]], ["2027-08-25", "Janmashtami", [...NORTH, "24", "27"]],
    ["2027-09-04", "Ganesh Chaturthi", ["27", "29", "30", "36", "37", "24"]], ["2027-09-12", "Onam", ["32"]], ["2027-10-08", "Durga Puja (Maha Navami)", ["19", "16", "18", "21", "20"]],
    ["2027-10-09", "Dussehra", [ALL]], ["2027-10-29", "Diwali", [ALL]], ["2027-11-14", "Guru Nanak Jayanti", [ALL]],
  ],
};
export const HOLIDAY_PRESET_YEARS = Object.freeze(Object.keys(FESTIVALS).map(Number));

function requireManage(context) {
  if (context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(MANAGE)) return;
  throw new CrmError(403, "You do not have permission to manage holidays.", "PERMISSION_DENIED");
}
const invalid = (field, message) => new CrmError(400, message, "CRM_HOLIDAY_VALIDATION", { issues: [{ field, message }] });

// The holidays a year offers for a state (or all-India ones without a state): [{ date, name, check }] by date; two on one day share it.
export function holidayPresets(year, state = null) {
  const value = Number(year);
  if (!FESTIVALS[value]) throw invalid("year", `Holidays can be suggested for ${HOLIDAY_PRESET_YEARS.join(" and ")}.`);
  const code = state ? findIndianState({ code: /^\d{1,2}$/.test(String(state)) ? state : undefined, name: /^\d{1,2}$/.test(String(state)) ? undefined : state })?.code : null;
  if (state && !code) throw invalid("state", "Choose the state.");
  const applies = (states) => states.includes(ALL) || (code && states.includes(code));
  const byDate = new Map();
  const add = (date, name, check) => {
    const current = byDate.get(date);
    byDate.set(date, current ? { ...current, name: `${current.name} / ${name}`, check: current.check || check } : { date, name, check });
  };
  for (const [day, name, states, moves] of FIXED) if (applies(states)) add(`${value}-${day}`, name, moves);
  for (const [date, name, states] of FESTIVALS[value]) if (applies(states)) add(date, name, true);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map((entry) => ({ ...entry, name: entry.name.slice(0, 80) }));
}

// input: { year, state?, dates? } — adds the year's suggestions (or only those dates); a date already a holiday is kept.
export async function addPresetHolidays(client, context, input = {}) {
  requireManage(context);
  const presets = holidayPresets(input.year, input.state || null);
  const chosen = Array.isArray(input.dates) ? new Set(input.dates.map(String)) : null;
  let added = 0;
  for (const holiday of presets) {
    if (chosen && !chosen.has(holiday.date)) continue;
    const { rowCount } = await client.query(
      "INSERT INTO tenant.crm_holidays (organization_id, holiday_date, name, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT (organization_id, holiday_date) DO NOTHING",
      [context.organizationId, holiday.date, holiday.name, context.userId ?? null]);
    added += rowCount;
  }
  return { added, holidays: await listHolidays(client, context, { year: Number(input.year) }) };
}
