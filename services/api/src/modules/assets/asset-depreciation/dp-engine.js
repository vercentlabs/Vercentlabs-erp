// Assets — Straight-Line Depreciation, the calculation: deterministic, in exact integer paise, from an immutable basis. Never floating point.
//
// Depreciable amount D = carrying value at the start of the basis − approved residual value, spread evenly over the remaining life in months.
// The accumulated charge after each period is rounded once from the exact fraction of the life elapsed (half-up), and each period's charge
// is the difference, so rounding never drifts and the last period closes exactly at the residual value.
//
// Conventions:
//   FULL_MONTH  every charged month is a whole month. Commencing on the 1st charges that month; commencing later in a month starts on the
//               1st of the next month. No charge in a month of disposal unless it is disposed on that month's last day.
//   DAILY       the first month is charged for the calendar days from the commencement date to the month end (inclusive) over that month's
//               real number of days (28, 29, 30 or 31 — never a fixed 30); the life then runs whole months, and the final month carries
//               the remaining days. A disposal month is charged for the days up to and including the disposal date.

const utc = (y, m, d) => new Date(Date.UTC(y, m, d));
const iso = (d) => d.toISOString().slice(0, 10);
export const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
export function parseDay(value) {
  const s = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const date = utc(y, m - 1, d);
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? { y, m: m - 1, d } : null;
}
// Half-up rounding of a non-negative rational a / b, in integers.
const roundDiv = (a, b) => (2n * a + b) / (2n * b);
// Amounts to integer paise; more decimals (the register keeps six) round half-up to the paisa.
export const toPaise = (v) => {
  const s = String(v ?? "0").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Not an amount: ${s}`);
  const neg = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const n = BigInt(whole) * 100n + BigInt((frac + "00").slice(0, 2)) + (Number(frac[2] ?? "0") >= 5 ? 1n : 0n);
  return neg ? -n : n;
};
export const sameAmount = (a, b) => toPaise(String(a ?? "0")) === toPaise(String(b ?? "0"));
export const fromPaise = (n) => {
  const neg = n < 0n;
  const a = neg ? -n : n;
  return `${neg ? "-" : ""}${a / 100n}.${String(a % 100n).padStart(2, "0")}`;
};

// input: { carrying, residual, months, commencement 'YYYY-MM-DD', convention, accumulatedBefore? } — amounts as decimal strings.
// Returns { lines: [{ periodStart, periodEnd, opening, amount, accumulated, closing, eligibleFrom, eligibleTo, eligibleDays, periodDays, rounding }], total, monthly, depreciable }.
export function calculateStraightLineSchedule(input) {
  const carrying = toPaise(input.carrying);
  const residual = toPaise(input.residual ?? "0");
  const months = Number(input.months);
  const start = parseDay(input.commencement);
  const convention = input.convention === "FULL_MONTH" ? "FULL_MONTH" : "DAILY";
  const before = toPaise(input.accumulatedBefore ?? "0");
  if (!Number.isInteger(months) || months < 1) throw Object.assign(new Error("A useful life of whole months is needed."), { code: "ASSET_DEPRECIATION_USEFUL_LIFE_INVALID" });
  if (!start) throw Object.assign(new Error("A valid commencement date is needed."), { code: "ASSET_DEPRECIATION_DATE_INVALID" });
  if (residual < 0n || residual > carrying) throw Object.assign(new Error("The residual value cannot exceed the carrying value."), { code: "ASSET_DEPRECIATION_RESIDUAL_INVALID" });
  const D = carrying - residual;
  const N = BigInt(months);
  const monthly = roundDiv(D, N);
  if (D === 0n) return { lines: [], total: "0.00", monthly: "0.00", depreciable: "0.00" };
  // The periods and the share of the life elapsed after each (as numerator over a common denominator).
  const periods = [];
  if (convention === "FULL_MONTH" || start.d === 1) {
    const first = start.d === 1 ? { y: start.y, m: start.m } : { y: start.m === 11 ? start.y + 1 : start.y, m: (start.m + 1) % 12 };
    for (let k = 1; k <= months; k += 1) {
      const p = utc(first.y, first.m + k - 1, 1);
      const y = p.getUTCFullYear(); const m = p.getUTCMonth(); const dim = daysIn(y, m);
      periods.push({ y, m, from: 1, to: dim, dim, num: BigInt(k), den: N, nominalNum: 1n, nominalDen: N });
    }
  } else {
    const dim1 = BigInt(daysIn(start.y, start.m));
    const e = dim1 - BigInt(start.d) + 1n;
    for (let k = 1; k <= months + 1; k += 1) {
      const p = utc(start.y, start.m + k - 1, 1);
      const y = p.getUTCFullYear(); const m = p.getUTCMonth(); const dim = daysIn(y, m);
      const last = k === months + 1;
      const from = k === 1 ? start.d : 1;
      const to = last ? Math.min(start.d - 1, dim) : dim;
      const num = last ? N * dim1 : e + BigInt(k - 1) * dim1;
      const share = k === 1 ? e : last ? dim1 - e : dim1;
      periods.push({ y, m, from, to, dim, num, den: N * dim1, nominalNum: share, nominalDen: N * dim1 });
    }
  }
  const lines = [];
  let prev = 0n;
  for (const [i, p] of periods.entries()) {
    const acc = i === periods.length - 1 ? D : roundDiv(D * p.num, p.den);
    const amount = acc - prev;
    const nominal = roundDiv(D * p.nominalNum, p.nominalDen);
    lines.push({
      periodStart: iso(utc(p.y, p.m, 1)), periodEnd: iso(utc(p.y, p.m, p.dim)), opening: fromPaise(carrying - prev), amount: fromPaise(amount),
      accumulated: fromPaise(before + acc), closing: fromPaise(carrying - acc), eligibleFrom: iso(utc(p.y, p.m, p.from)), eligibleTo: iso(utc(p.y, p.m, p.to)),
      eligibleDays: p.to - p.from + 1, periodDays: p.dim, rounding: fromPaise(amount - nominal),
    });
    prev = acc;
  }
  return { lines, total: fromPaise(D), monthly: fromPaise(monthly), depreciable: fromPaise(D) };
}

// The charge due for a scheduled month when the asset is disposed of on `disposalDay` (YYYY-MM-DD): the whole line when disposed after the
// month, nothing when disposed before it, and within the month as the convention says.
export function chargeThroughDisposal(line, disposalDay, convention) {
  const amount = toPaise(line.amount);
  const disposal = String(disposalDay);
  const periodStart = String(line.period_start ?? line.periodStart).slice(0, 10);
  const periodEnd = String(line.period_end ?? line.periodEnd).slice(0, 10);
  if (disposal >= periodEnd) return fromPaise(amount);
  if (disposal < periodStart) return "0.00";
  if (convention === "FULL_MONTH") return "0.00";
  const from = String(line.eligible_from ?? line.eligibleFrom).slice(0, 10);
  const to = String(line.eligible_to ?? line.eligibleTo).slice(0, 10);
  if (disposal < from) return "0.00";
  if (disposal >= to) return fromPaise(amount);
  const day = (s) => Date.parse(`${s}T00:00:00Z`) / 864e5;
  const through = BigInt(day(disposal) - day(from) + 1);
  const eligible = BigInt(day(to) - day(from) + 1);
  return fromPaise(roundDiv(amount * through, eligible));
}

// The commencement a policy's rule gives for an asset available for use on `availableDay`.
export function commencementFor(availableDay, rule) {
  const d = parseDay(availableDay);
  if (!d) return null;
  if (rule === "NEXT_MONTH" && d.d !== 1) return iso(utc(d.y, d.m + 1, 1));
  return availableDay;
}
// The Indian financial year (April–March) a month belongs to, e.g. 2026-05-01 → "FY 2026-27".
export const financialYearOf = (periodStart) => {
  const d = parseDay(String(periodStart).slice(0, 10));
  const startYear = d.m >= 3 ? d.y : d.y - 1;
  return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
};
