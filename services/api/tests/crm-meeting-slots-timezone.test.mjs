import assert from "node:assert/strict";
import test from "node:test";

import { calculateMeetingSlots, calendarDateInZone, zonedWallTimeToUtc } from "../src/modules/crm/seller-activity-and-follow-up-workspace/communications.js";

const availability = { monday: [{ start: "09:00", end: "10:00" }] };
const base = { date: "2026-11-30", durationMinutes: 30, availability, now: new Date("2026-01-01T00:00:00Z") };

test("a host's 09:00 means 09:00 in the link's time zone, not 09:00 UTC", () => {
  const india = calculateMeetingSlots({ ...base, timeZone: "Asia/Kolkata" });
  assert.equal(india[0].startsAt, "2026-11-30T03:30:00.000Z");
  assert.equal(india.at(-1).endsAt, "2026-11-30T04:30:00.000Z");
  const utc = calculateMeetingSlots({ ...base, timeZone: "UTC" });
  assert.equal(utc[0].startsAt, "2026-11-30T09:00:00.000Z");
  assert.equal(calculateMeetingSlots(base)[0].startsAt, "2026-11-30T09:00:00.000Z", "no zone given keeps the old UTC reading");
});

test("daylight saving is honoured on the day in question", () => {
  assert.equal(zonedWallTimeToUtc("2026-07-01", 9, 0, "America/New_York").toISOString(), "2026-07-01T13:00:00.000Z");
  assert.equal(zonedWallTimeToUtc("2026-12-01", 9, 0, "America/New_York").toISOString(), "2026-12-01T14:00:00.000Z");
});

test("the Calcutta and Kolkata names behave identically", () => {
  assert.equal(zonedWallTimeToUtc("2026-11-30", 9, 0, "Asia/Calcutta").toISOString(), zonedWallTimeToUtc("2026-11-30", 9, 0, "Asia/Kolkata").toISOString());
});

test("a late-evening slot belongs to the host day, not the UTC day", () => {
  const late = calculateMeetingSlots({ date: "2026-11-30", durationMinutes: 30, availability: { monday: [{ start: "00:30", end: "01:30" }] }, timeZone: "Asia/Kolkata", now: new Date("2026-01-01T00:00:00Z") });
  assert.equal(late[0].startsAt, "2026-11-29T19:00:00.000Z");
  assert.equal(calendarDateInZone(late[0].startsAt, "Asia/Kolkata"), "2026-11-30");
  assert.equal(calendarDateInZone(late[0].startsAt, "UTC"), "2026-11-29");
});

test("an unknown time zone falls back to UTC instead of throwing", () => {
  assert.equal(calculateMeetingSlots({ ...base, timeZone: "Not/AZone" })[0].startsAt, "2026-11-30T09:00:00.000Z");
});
