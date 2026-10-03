// Working-hours arithmetic for reminders: adds minutes to an instant counting
// only time inside the schedule's window, so a reminder that would fire at
// 2am moves to the start of the next working window.
function parseClock(value, fallbackHour) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  return match ? [Number(match[1]), Number(match[2])] : [fallbackHour, 0];
}

export function addBusinessMinutes(startValue, minutesValue, schedule = {}) {
  const weekdays = new Set(Array.isArray(schedule.weekdays) && schedule.weekdays.length ? schedule.weekdays.map(Number) : [1, 2, 3, 4, 5]);
  const [startHour, startMinute] = parseClock(schedule.start, 9);
  const [endHour, endMinute] = parseClock(schedule.end, 18);
  let remaining = Math.max(0, Math.ceil(Number(minutesValue) || 0));
  let cursor = new Date(startValue);
  const moveToWindow = () => {
    while (true) {
      const start = new Date(cursor);
      start.setUTCHours(startHour, startMinute, 0, 0);
      const end = new Date(cursor);
      end.setUTCHours(endHour, endMinute, 0, 0);
      if (!weekdays.has(cursor.getUTCDay()) || cursor >= end) {
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
