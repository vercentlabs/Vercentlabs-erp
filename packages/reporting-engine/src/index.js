function neutralizeFormula(value) {
  const text = value == null ? "" : String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function csvCell(value) {
  const text = neutralizeFormula(value).replaceAll('"', '""');
  return /[",\n\r]/.test(text) ? `"${text}"` : text;
}

export function rowsToCsv(columns, rows) {
  if (!Array.isArray(columns) || !columns.length) throw new TypeError("At least one report column is required.");
  const header = columns.map((column) => csvCell(column.label)).join(",");
  const body = rows.map((row) => columns.map((column) => csvCell(row[column.key])).join(","));
  return `\uFEFF${[header, ...body].join("\r\n")}\r\n`;
}

export function normalizePage(input = {}) {
  const limit = Math.min(250, Math.max(1, Number.parseInt(String(input.limit || "50"), 10) || 50));
  const offset = Math.max(0, Number.parseInt(String(input.offset || "0"), 10) || 0);
  return Object.freeze({ limit, offset });
}

export function createReportRegistry(definitions) {
  const reports = new Map();
  for (const definition of definitions) {
    if (!definition?.key || !Array.isArray(definition.columns) || typeof definition.execute !== "function") throw new TypeError("Invalid report definition.");
    if (reports.has(definition.key)) throw new TypeError(`Duplicate report definition: ${definition.key}`);
    reports.set(definition.key, Object.freeze({ ...definition, columns: Object.freeze([...definition.columns]) }));
  }
  return Object.freeze({
    keys: () => Object.freeze([...reports.keys()]),
    get: (key) => reports.get(key) || null,
    async execute(key, context, filters) {
      const report = reports.get(key);
      if (!report) throw new RangeError("Unknown report.");
      const result = await report.execute(context, filters);
      return Object.freeze({ key, columns: report.columns, ...result });
    },
  });
}
