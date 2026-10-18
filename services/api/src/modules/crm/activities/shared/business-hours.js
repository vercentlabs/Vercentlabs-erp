// Working-hours arithmetic for reminders: adds minutes to an instant counting
// only time inside the schedule's window, so a reminder that would fire at
// 2am moves to the start of the next working window.
function parseClock(value, fallbackHour) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  return match ? [Number(match[1]), Number(match[2])] : [fallbackHour, 0];
}

function addWallMinutes(startValue, minutesValue, schedule = {}) {
  const weekdays = new Set(Array.isArray(schedule.weekdays) && schedule.weekdays.length ? schedule.weekdays.map(Number) : [1, 2, 3, 4, 5]);
  const [startHour, startMinute] = parseClock(schedule.start, 9);
  const [endHour, endMinute] = parseClock(schedule.end, 18);
  // Holidays (CRM plan 5.6): wall-clock days, as YYYY-MM-DD, with no working hours at all.
  const holidays = new Set(Array.isArray(schedule.holidays) ? schedule.holidays.map(String) : []);
  const isHoliday = (at) => holidays.size > 0 && holidays.has(at.toISOString().slice(0, 10));
  let remaining = Math.max(0, Math.ceil(Number(minutesValue) || 0));
  let cursor = new Date(startValue);
  const moveToWindow = () => {
    while (true) {
      const start = new Date(cursor);
      start.setUTCHours(startHour, startMinute, 0, 0);
      const end = new Date(cursor);
      end.setUTCHours(endHour, endMinute, 0, 0);
      if (!weekdays.has(cursor.getUTCDay()) || isHoliday(cursor) || cursor >= end) {
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        cursor.setUTCHours(startHour, startMinute, 0, 0);
        continue;
      }
      if (cursor < start) cursor = start;
      return end;
    }
  };
  while (remaining > 0) {
    const end = moveToWindow();
    const available = Math.max(0, Math.floor((end - cursor) / 60000));
    const used = Math.min(remaining, available);
    cursor = new Date(cursor.getTime() + used * 60000);
    remaining -= used;
    if (remaining > 0) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(startHour, startMinute, 0, 0);
    }
  }
  return cursor;
}

// How far the zone's clock is ahead of UTC at an instant, in minutes (IST: 330).
function zoneOffsetMinutes(timeZone, at) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(at).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  return Math.round((Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - at.getTime()) / 60000);
}

// The working window is read on the schedule's own clock (schedule.timezone, e.g. Asia/Kolkata: 09:00-18:00 IST), not UTC.
export function addBusinessMinutes(startValue, minutesValue, schedule = {}) {
  const start = new Date(startValue);
  let offset = 0;
  try { offset = schedule.timezone ? zoneOffsetMinutes(schedule.timezone, start) : 0; } catch { offset = 0; }
  const wall = addWallMinutes(new Date(start.getTime() + offset * 60000), minutesValue, schedule);
  let back = offset;
  try { back = schedule.timezone ? zoneOffsetMinutes(schedule.timezone, new Date(wall.getTime() - offset * 60000)) : 0; } catch { back = offset; }
  return new Date(wall.getTime() - back * 60000);
}
