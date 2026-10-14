// Proposed codes for POS setup records. A proposal fills the field until the person types their own; the server still checks uniqueness.

// From a name: the first letters of its words (or the first word's letters when it is one word), upper case, made unique with -2, -3...
// "Vercent Retail Mart - Pune" -> "VRMP"; "Koregaon Park" -> "KP"; "Andheri" -> "ANDHER".
export function codeFromName(name: string, taken: string[], max = 6): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").split(" ").filter(Boolean);
  if (!words.length) return "";
  const base = (words.length === 1 ? words[0] : words.map((word) => word[0]).join("")).slice(0, max);
  return unique(base, taken);
}

// The next numbered code in a series: T01, T02... after the highest one already used.
export function nextNumberedCode(prefix: string, taken: string[], width = 2): string {
  const pattern = new RegExp(`^${prefix}(\\d+)$`, "i");
  const highest = taken.reduce((top, code) => Math.max(top, Number(pattern.exec(code.trim())?.[1] ?? 0)), 0);
  return `${prefix}${String(highest + 1).padStart(width, "0")}`;
}

function unique(base: string, taken: string[]): string {
  const used = new Set(taken.map((code) => code.trim().toUpperCase()));
  if (!used.has(base)) return base;
  for (let n = 2; ; n += 1) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

// From a name, word for word: "Senior Cashier" -> "SENIOR-CASHIER".
export function slugCode(name: string, max = 40): string {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "");
}
