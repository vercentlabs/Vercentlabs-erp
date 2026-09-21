import assert from "node:assert/strict";
import test from "node:test";

import { canonicalTimezone, formatMinutes, dueLabel, dueState, formatMoney, humanize, isoToLocalParts, localToIso, reminderLabel, reminderOffsetsLabel, timezoneLabel } from "./human.ts";

test("humanize turns stored tokens into product copy", () => {
  assert.equal(humanize("not_reviewed"), "Not reviewed");
  assert.equal(humanize("in_app"), "In app");
  assert.equal(humanize("firstName"), "First name");
  assert.equal(humanize("productInterest"), "Product interest");
  assert.equal(humanize("companyName"), "Company name");
  assert.equal(humanize("whatsapp"), "WhatsApp");
  assert.equal(humanize("sms"), "SMS");
  assert.equal(humanize(null), "");
});

test("reminder minutes map to words and back to the same numbers", () => {
  assert.equal(reminderLabel(0), "At due time");
  assert.equal(reminderLabel(60), "1 hour before");
  assert.equal(reminderLabel(1440), "1 day before");
  assert.equal(reminderLabel(2880), "2 days before");
  assert.equal(reminderLabel(10080), "1 week before");
  assert.equal(reminderLabel(45), "45 minutes before");
  assert.equal(reminderOffsetsLabel([0, 1440, 60]), "1 day before, 1 hour before, At due time");
  assert.equal(reminderOffsetsLabel([]), "No reminders");
});

test("the two names for India's time zone read as one", () => {
  assert.equal(canonicalTimezone("Asia/Calcutta"), "Asia/Kolkata");
  assert.equal(timezoneLabel("Asia/Calcutta"), timezoneLabel("Asia/Kolkata"));
  assert.match(timezoneLabel("Asia/Kolkata"), /India Standard Time \(GMT\+5:30\)/);
});

test("wall clock in a zone converts to the stored instant and back", () => {
  const iso = localToIso("2026-11-28", "23:30", "Asia/Kolkata");
  assert.equal(iso, "2026-11-28T18:00:00.000Z");
  assert.deepEqual(isoToLocalParts(iso, "Asia/Kolkata"), { date: "2026-11-28", time: "23:30" });
  assert.deepEqual(isoToLocalParts(iso, "UTC"), { date: "2026-11-28", time: "18:00" });
  assert.equal(localToIso("2026-07-01", "09:00", "America/New_York"), "2026-07-01T13:00:00.000Z");
  assert.equal(localToIso("", "09:00", "UTC"), "");
});

test("money carries its currency and grouping", () => {
  assert.match(formatMoney("INR", 1250000), /12,50,000/);
  assert.match(formatMoney("INR", "10000.00"), /₹/);
  assert.equal(formatMoney("INR", null), "");
});

test("overdue work is never presented as ordinary planned work", () => {
  const now = new Date("2026-09-21T10:00:00Z");
  assert.equal(dueState("2026-09-19T10:00:00Z", now), "overdue");
  assert.equal(dueState("2026-09-21T15:00:00Z", now), "today");
  assert.equal(dueState("2026-09-21T08:00:00Z", now), "overdue");
  assert.equal(dueState("2026-09-25T10:00:00Z", now), "upcoming");
  assert.equal(dueState(null, now), "none");
  assert.equal(dueLabel("2026-09-19T10:00:00Z", now), "Overdue by 2 days");
});

test("minutes read as a duration", () => {
  assert.equal(formatMinutes(1440), "1 day");
  assert.equal(formatMinutes(90), "1 hour 30 minutes");
  assert.equal(formatMinutes(45), "45 minutes");
  assert.equal(formatMinutes(2880 + 60), "2 days 1 hour");
  assert.equal(formatMinutes(null), "");
});
