// F418-F422: salary components, earnings and deductions, salary structures (versioned, formula
// driven, approved by a second person), and each employee's compensation assignment with a frozen
// monthly breakup.
import {
  HrError, canSeeSensitive, dateRequired, has, hasAny, need, needAny, nonNegative, oneOf, ownEmployee, qx, recordEvent, round2, text, textOrNull, today, uuid, uuidOrNull, addDays,
} from "./common.js";

const KINDS = ["basic", "allowance", "bonus", "incentive", "reimbursement", "arrear", "overtime", "loan", "advance", "statutory", "other"];
const TYPES = ["earning", "deduction", "employer_contribution"];
const CALC = ["fixed", "percentage", "formula", "statutory"];
const MANAGE = "hr_payroll.compensation.manage";
const SEE = [MANAGE, "hr_payroll.sensitive.view"];

// Extension point: other slices (arrears) react to an approved compensation change.
export const COMPENSATION_HOOKS = { afterApprove: null };

// ---------------------------------------------------------------- formula language
// numbers, identifiers (component codes, CTC), + - * / ( ) and min(), max(), round(). No eval.
export function tokenize(src) {
  const out = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(.))/gy;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[1] !== undefined) out.push({ t: "num", v: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ t: "id", v: m[2].toUpperCase() });
    else if (m[3] !== undefined && m[3].trim()) out.push({ t: "op", v: m[3] });
    if (re.lastIndex >= src.length) break;
  }
  return out;
}
export function parseExpression(src) {
  const toks = tokenize(String(src));
  let i = 0;
  const peek = () => toks[i];
  const take = (v) => {
    const t = toks[i];
    if (!t || (v !== undefined && t.v !== v)) throw new HrError(400, `The formula "${src}" is not valid.`, "HR_FORMULA_INVALID");
    i += 1;
    return t;
  };
  const expr = () => {
    let n = term();
    while (peek() && (peek().v === "+" || peek().v === "-") && peek().t === "op") { const op = take().v; n = { k: "bin", op, l: n, r: term() }; }
    return n;
  };
  const term = () => {
    let n = unary();
    while (peek() && (peek().v === "*" || peek().v === "/") && peek().t === "op") { const op = take().v; n = { k: "bin", op, l: n, r: unary() }; }
    return n;
  };
  const unary = () => {
    if (peek() && peek().t === "op" && peek().v === "-") { take(); return { k: "neg", e: unary() }; }
    return atom();
  };
  const atom = () => {
    const t = peek();
    if (!t) throw new HrError(400, `The formula "${src}" ends unexpectedly.`, "HR_FORMULA_INVALID");
    if (t.t === "num") { take(); return { k: "num", v: t.v }; }
    if (t.t === "op" && t.v === "(") { take(); const e = expr(); take(")"); return e; }
    if (t.t === "id") {
      take();
      if (peek() && peek().v === "(") {
        if (!["MIN", "MAX", "ROUND"].includes(t.v)) throw new HrError(400, `Unknown function ${t.v} in "${src}".`, "HR_FORMULA_INVALID");
        take("(");
        const args = [expr()];
        while (peek() && peek().v === ",") { take(","); args.push(expr()); }
        take(")");
        return { k: "fn", name: t.v, args };
      }
      return { k: "var", v: t.v };
    }
    throw new HrError(400, `The formula "${src}" is not valid.`, "HR_FORMULA_INVALID");
  };
  const tree = expr();
  if (i !== toks.length) throw new HrError(400, `The formula "${src}" is not valid.`, "HR_FORMULA_INVALID");
  return tree;
}
export const formulaVariables = (tree, acc = new Set()) => {
  if (tree.k === "var") acc.add(tree.v);
  else if (tree.k === "bin") { formulaVariables(tree.l, acc); formulaVariables(tree.r, acc); }
  else if (tree.k === "neg") formulaVariables(tree.e, acc);
  else if (tree.k === "fn") tree.args.forEach((a) => formulaVariables(a, acc));
  return acc;
};
export function evaluateExpression(src, vars) {
  const go = (n) => {
    switch (n.k) {
      case "num": return n.v;
      case "var": if (!(n.v in vars)) throw new HrError(400, `The formula uses ${n.v}, which has no value here.`, "HR_FORMULA_UNKNOWN"); return vars[n.v];
      case "neg": return -go(n.e);
      case "bin": { const a = go(n.l); const b = go(n.r); if (n.op === "/") { if (b === 0) throw new HrError(400, "The formula divides by zero.", "HR_FORMULA_INVALID"); return a / b; } return n.op === "+" ? a + b : n.op === "-" ? a - b : a * b; }
      case "fn": { const v = n.args.map(go); return n.name === "MIN" ? Math.min(...v) : n.name === "MAX" ? Math.max(...v) : Math.round(v[0] * 10 ** (v[1] ?? 0)) / 10 ** (v[1] ?? 0); }
      default: throw new HrError(400, "The formula is not valid.", "HR_FORMULA_INVALID");
    }
  };
  return go(parseExpression(src));
}

// ---------------------------------------------------------------- components (F418-F420)
export async function listSalaryComponents(client, c, filters = {}) {
  needAny(c, [...SEE, "hr_payroll.statutory.manage", "hr_payroll.payroll.prepare"]);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.type) { params.push(String(filters.type)); extra = ` AND t.component_type=$3`; }
  const { rows } = await qx(client, `SELECT t.*, (SELECT count(*) FROM tenant.hr_salary_structure_lines l WHERE l.salary_component_id=t.id)::int AS structures FROM tenant.hr_salary_components t WHERE t.organization_id=$1 AND t.company_id=$2${extra} ORDER BY t.component_type, t.display_order, t.code`, params);
  return rows;
}
export async function saveSalaryComponent(client, c, input) {
  need(c, MANAGE);
  const code = text(input.code, 30).toUpperCase();
  const name = text(input.name, 120);
  if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(code)) throw new HrError(400, "A component code is letters, digits and _, starting with a letter (it is used in formulas).", "HR_COMPONENT_INVALID");
  if (["CTC", "MIN", "MAX", "ROUND"].includes(code)) throw new HrError(400, `${code} is reserved by the formula language.`, "HR_COMPONENT_INVALID");
  if (!name) throw new HrError(400, "A component needs a name.", "HR_COMPONENT_INVALID");
  const type = oneOf(String(input.componentType ?? "earning"), TYPES, "Component type");
  const kind = oneOf(String(input.componentKind ?? (type === "earning" ? "allowance" : "other")), KINDS, "Kind");
  const calc = oneOf(String(input.calculationType ?? "fixed"), CALC, "Calculation");
  if (type === "earning" && kind === "statutory") throw new HrError(400, "An earning cannot be a statutory component.", "HR_COMPONENT_INVALID");
  const vals = [name, kind, calc, input.taxable !== false, input.prorated !== false, input.pfWage === true, input.esicWage !== false, Math.trunc(nonNegative(input.displayOrder, "Order", 100)), textOrNull(input.description, 500), uuidOrNull(input.accountingAccountId, "Account"), input.active !== false];
  if (input.id) {
    const cur = (await qx(client, `SELECT t.*, (SELECT count(*) FROM tenant.hr_salary_structure_lines l WHERE l.salary_component_id=t.id)::int AS used FROM tenant.hr_salary_components t WHERE t.organization_id=$1 AND t.company_id=$2 AND t.id=$3`, [c.organizationId, c.companyId, uuid(input.id, "Component")])).rows[0];
    if (!cur) throw new HrError(404, "Component was not found.", "HR_COMPONENT_NOT_FOUND");
    if (cur.used > 0 && cur.component_type !== type) throw new HrError(409, "A component that structures use cannot change between earning, deduction and employer contribution.", "HR_COMPONENT_IN_USE");
    if (cur.used > 0 && !vals[10]) throw new HrError(409, "A component in use by a structure cannot be deactivated. Revise the structures first.", "HR_COMPONENT_IN_USE");
    const { rows } = await qx(client, `UPDATE tenant.hr_salary_components SET name=$4, component_type=$12, component_kind=$5, calculation_type=$6, taxable=$7, prorated=$8, pf_wage=$9, esic_wage=$10, display_order=$11, description=$13, accounting_account_id=$14, active=$15 WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
      [c.organizationId, c.companyId, cur.id, vals[0], vals[1], vals[2], vals[3], vals[4], vals[5], vals[6], vals[7], type, vals[8], vals[9], vals[10]]);
    return rows[0];
  }
  const dup = await qx(client, `SELECT 1 FROM tenant.hr_salary_components WHERE organization_id=$1 AND company_id=$2 AND code=$3`, [c.organizationId, c.companyId, code]);
  if (dup.rows[0]) throw new HrError(409, `Component ${code} already exists.`, "HR_COMPONENT_DUPLICATE");
  const { rows } = await qx(client, `INSERT INTO tenant.hr_salary_components(organization_id,company_id,code,name,component_type,component_kind,calculation_type,taxable,prorated,pf_wage,esic_wage,display_order,description,accounting_account_id,active,affects_gross,affects_net,created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [c.organizationId, c.companyId, code, vals[0], type, vals[1], vals[2], vals[3], vals[4], vals[5], vals[6], vals[7], vals[8], vals[9], vals[10], type === "earning", type !== "employer_contribution", c.userId]);
  return rows[0];
}

// A component the engine itself needs (overtime, bonus, arrears ...), created on first use.
export async function ensureSystemComponent(client, c, code, name, type, kind, { taxable = true } = {}) {
  const cur = (await qx(client, `SELECT * FROM tenant.hr_salary_components WHERE organization_id=$1 AND company_id=$2 AND code=$3`, [c.organizationId, c.companyId, code])).rows[0];
  if (cur) return cur;
  const { rows } = await qx(client, `INSERT INTO tenant.hr_salary_components(organization_id,company_id,code,name,component_type,component_kind,calculation_type,taxable,prorated,pf_wage,esic_wage,affects_gross,affects_net,created_by) VALUES ($1,$2,$3,$4,$5,$6,'fixed',$7,false,false,true,$8,$9,$10) RETURNING *`,
    [c.organizationId, c.companyId, code, name, type, kind, taxable, type === "earning", type !== "employer_contribution", c.userId]);
  return rows[0];
}

// ---------------------------------------------------------------- structures (F421)
async function loadStructure(client, c, id, lock = false) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_salary_structures WHERE organization_id=$1 AND company_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`, [c.organizationId, c.companyId, uuid(id, "Structure")]);
  if (!rows[0]) throw new HrError(404, "Salary structure was not found.", "HR_STRUCTURE_NOT_FOUND");
  return rows[0];
}
async function loadLines(client, structureId) {
  return (await qx(client, `SELECT l.*, t.code AS component_code, t.name AS component_name, t.component_type, t.component_kind, t.calculation_type, t.taxable, t.prorated, t.pf_wage, t.esic_wage FROM tenant.hr_salary_structure_lines l JOIN tenant.hr_salary_components t ON t.id=l.salary_component_id WHERE l.salary_structure_id=$1 ORDER BY l.sequence`, [structureId])).rows;
}

export async function listSalaryStructures(client, c, filters = {}) {
  needAny(c, SEE);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.status) { params.push(String(filters.status)); extra = ` AND s.status=$3`; }
  const { rows } = await qx(client, `SELECT s.*, (SELECT count(*) FROM tenant.hr_salary_structure_lines l WHERE l.salary_structure_id=s.id)::int AS line_count, (SELECT count(*) FROM tenant.hr_employee_compensation e WHERE e.salary_structure_id=s.id AND e.status='active')::int AS employees FROM tenant.hr_salary_structures s WHERE s.organization_id=$1 AND s.company_id=$2${extra} ORDER BY s.code, s.version DESC`, params);
  return rows;
}
export async function getSalaryStructure(client, c, id) {
  needAny(c, SEE);
  const s = await loadStructure(client, c, id);
  return { ...s, lines: await loadLines(client, s.id) };
}

// Normalise and validate the lines of a structure. Lines are evaluated in sequence; a line may only
// refer to earlier lines (or CTC), so there can be no circular reference. One line may be the
// balancing allowance: CTC less everything else.
async function normaliseLines(client, c, lines) {
  if (!Array.isArray(lines) || !lines.length) throw new HrError(400, "A structure needs at least one component line.", "HR_STRUCTURE_INVALID");
  if (lines.length > 60) throw new HrError(400, "A structure can have at most 60 lines.", "HR_STRUCTURE_INVALID");
  const out = [];
  const seenCodes = new Set();
  const known = new Set(["CTC"]);
  let balance = 0;
  let seq = 0;
  for (const raw of lines) {
    seq += 1;
    const comp = (await qx(client, `SELECT * FROM tenant.hr_salary_components WHERE organization_id=$1 AND company_id=$2 AND active AND (id=$3::uuid OR code=$4)`, [c.organizationId, c.companyId, uuidOrNull(raw.componentId, "Component"), raw.componentCode ? text(raw.componentCode, 30).toUpperCase() : null])).rows[0];
    if (!comp) throw new HrError(400, `Line ${seq}: the salary component was not found or is inactive.`, "HR_STRUCTURE_INVALID");
    if (seenCodes.has(comp.code)) throw new HrError(400, `${comp.code} appears twice in the structure.`, "HR_STRUCTURE_INVALID");
    seenCodes.add(comp.code);
    const isBalance = raw.isBalance === true;
    if (isBalance) {
      balance += 1;
      if (comp.component_type !== "earning") throw new HrError(400, "Only an earning can balance the CTC.", "HR_STRUCTURE_INVALID");
      if (balance > 1) throw new HrError(400, "Only one line can balance the CTC.", "HR_STRUCTURE_INVALID");
    }
    const formula = textOrNull(raw.formula, 500);
    const pct = raw.percentage === undefined || raw.percentage === "" || raw.percentage === null ? null : Number(raw.percentage);
    const amt = raw.amount === undefined || raw.amount === "" || raw.amount === null ? null : Number(raw.amount);
    const percentOf = raw.percentOf ? text(raw.percentOf, 30).toUpperCase() : null;
    if (comp.calculation_type === "statutory") {
      out.push({ comp, sequence: seq, amount: null, percentage: null, formula: null, percentOf: null, min: null, max: null, isBalance: false });
      continue;
    }
    const defined = [formula !== null, pct !== null, amt !== null, isBalance].filter(Boolean).length;
    if (defined !== 1) throw new HrError(400, `${comp.code}: give exactly one of a fixed amount, a percentage, a formula, or make it the balancing line.`, "HR_STRUCTURE_INVALID");
    if (pct !== null && !(pct >= 0 && pct <= 1000)) throw new HrError(400, `${comp.code}: the percentage is not valid.`, "HR_STRUCTURE_INVALID");
    if (amt !== null && !(amt >= 0)) throw new HrError(400, `${comp.code}: the amount is not valid.`, "HR_STRUCTURE_INVALID");
    if (pct !== null && percentOf && !known.has(percentOf)) throw new HrError(400, `${comp.code}: ${percentOf} must be CTC or a component earlier in the structure.`, "HR_STRUCTURE_INVALID");
    if (formula !== null) {
      const vars = formulaVariables(parseExpression(formula));
      for (const v of vars) if (!known.has(v)) throw new HrError(400, `${comp.code}: the formula uses ${v}, which is not CTC or an earlier component.`, "HR_STRUCTURE_INVALID");
    }
    const min = raw.minimumAmount === undefined || raw.minimumAmount === "" || raw.minimumAmount === null ? null : Number(raw.minimumAmount);
    const max = raw.maximumAmount === undefined || raw.maximumAmount === "" || raw.maximumAmount === null ? null : Number(raw.maximumAmount);
    if (min !== null && max !== null && max < min) throw new HrError(400, `${comp.code}: the maximum is below the minimum.`, "HR_STRUCTURE_INVALID");
    out.push({ comp, sequence: seq, amount: amt, percentage: pct, formula, percentOf: pct !== null ? percentOf || "CTC" : null, min, max, isBalance });
    known.add(comp.code);
  }
  if (!out.some((l) => l.comp.component_type === "earning")) throw new HrError(400, "A structure needs at least one earning.", "HR_STRUCTURE_INVALID");
  // the balancing line is evaluated last
  const bal = out.findIndex((l) => l.isBalance);
  if (bal !== -1 && bal !== out.length - 1) throw new HrError(400, "The balancing line must be the last line.", "HR_STRUCTURE_INVALID");
  return out;
}
async function writeLines(client, c, structureId, lines) {
  await qx(client, `DELETE FROM tenant.hr_salary_structure_lines WHERE salary_structure_id=$1`, [structureId]);
  for (const l of lines) {
    await qx(client, `INSERT INTO tenant.hr_salary_structure_lines(organization_id,salary_structure_id,salary_component_id,sequence,amount,percentage,formula,minimum_amount,maximum_amount,percent_of,is_balance) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [c.organizationId, structureId, l.comp.id, l.sequence, l.amount, l.percentage, l.formula, l.min, l.max, l.percentOf, l.isBalance]);
  }
}

export async function createSalaryStructure(client, c, input) {
  need(c, MANAGE);
  const code = text(input.code, 30).toUpperCase();
  const name = text(input.name, 120);
  if (!/^[A-Z0-9_-]{2,30}$/.test(code) || !name) throw new HrError(400, "A structure needs a code and a name.", "HR_STRUCTURE_INVALID");
  const freq = oneOf(String(input.payFrequency ?? "monthly"), ["weekly", "biweekly", "monthly"], "Pay frequency");
  const cfg = (await qx(client, `SELECT default_currency_code FROM tenant.hr_payroll_settings WHERE organization_id=$1 AND company_id=$2`, [c.organizationId, c.companyId])).rows[0];
  const dup = await qx(client, `SELECT 1 FROM tenant.hr_salary_structures WHERE organization_id=$1 AND company_id=$2 AND code=$3`, [c.organizationId, c.companyId, code]);
  if (dup.rows[0]) throw new HrError(409, `Structure ${code} already exists. Revise it to make a new version.`, "HR_STRUCTURE_DUPLICATE");
  const lines = await normaliseLines(client, c, input.lines);
  const { rows } = await qx(client, `INSERT INTO tenant.hr_salary_structures(organization_id,company_id,code,name,version,status,currency_code,pay_frequency,created_by,notes) VALUES ($1,$2,$3,$4,1,'draft',$5,$6,$7,$8) RETURNING *`, [c.organizationId, c.companyId, code, name, cfg?.default_currency_code ?? "INR", freq, c.userId, textOrNull(input.notes, 1000)]);
  await writeLines(client, c, rows[0].id, lines);
  await recordEvent(client, c, "salary_structure", rows[0].id, "hr.structure.created", { code });
  return { ...rows[0], lines: await loadLines(client, rows[0].id) };
}
export async function updateDraftStructure(client, c, id, input) {
  need(c, MANAGE);
  const s = await loadStructure(client, c, id, true);
  if (s.status !== "draft") throw new HrError(409, "Only a draft structure can be edited. Revise an active one to change it.", "HR_STRUCTURE_STATE");
  const name = input.name === undefined ? s.name : text(input.name, 120);
  if (!name) throw new HrError(400, "A structure needs a name.", "HR_STRUCTURE_INVALID");
  if (input.lines !== undefined) await writeLines(client, c, s.id, await normaliseLines(client, c, input.lines));
  const { rows } = await qx(client, `UPDATE tenant.hr_salary_structures SET name=$2, notes=$3 WHERE id=$1 RETURNING *`, [s.id, name, input.notes === undefined ? s.notes : textOrNull(input.notes, 1000)]);
  return { ...rows[0], lines: await loadLines(client, s.id) };
}
export async function submitSalaryStructure(client, c, id) {
  need(c, MANAGE);
  const s = await loadStructure(client, c, id, true);
  if (s.status !== "draft") throw new HrError(409, "Only a draft structure can be submitted.", "HR_STRUCTURE_STATE");
  await normaliseLinesFromDb(client, c, s.id);
  const { rows } = await qx(client, `UPDATE tenant.hr_salary_structures SET status='pending_approval', submitted_by=$2 WHERE id=$1 RETURNING *`, [s.id, c.userId]);
  return rows[0];
}
async function normaliseLinesFromDb(client, c, id) {
  const lines = await loadLines(client, id);
  if (!lines.length) throw new HrError(400, "The structure has no lines.", "HR_STRUCTURE_INVALID");
  // a dry run with a sample CTC proves every formula evaluates
  computeBreakup(lines, 1200000);
}
export async function decideSalaryStructure(client, c, id, { approve, note }) {
  need(c, MANAGE);
  const s = await loadStructure(client, c, id, true);
  if (s.status !== "pending_approval") throw new HrError(409, "Only a structure awaiting approval can be decided.", "HR_STRUCTURE_STATE");
  if (s.created_by === c.userId || s.submitted_by === c.userId) throw new HrError(403, "A structure must be approved by someone other than the people who prepared and submitted it.", "SELF_APPROVAL_BLOCKED");
  if (!approve && !text(note)) throw new HrError(400, "Give a reason for sending the structure back.", "HR_REASON_REQUIRED");
  if (!approve) {
    const { rows } = await qx(client, `UPDATE tenant.hr_salary_structures SET status='draft', notes=coalesce(notes,'') || $2 WHERE id=$1 RETURNING *`, [s.id, `\nReturned: ${text(note, 300)}`]);
    return rows[0];
  }
  // one active version per code: the version it replaces stays on the compensation already frozen on it
  await qx(client, `UPDATE tenant.hr_salary_structures SET status='inactive' WHERE organization_id=$1 AND company_id=$2 AND code=$3 AND status='active' AND id <> $4`, [c.organizationId, c.companyId, s.code, s.id]);
  const { rows } = await qx(client, `UPDATE tenant.hr_salary_structures SET status='active', approved_by=$2, approved_at=now() WHERE id=$1 RETURNING *`, [s.id, c.userId]);
  await recordEvent(client, c, "salary_structure", s.id, "hr.structure.approved", { code: s.code, version: s.version });
  return rows[0];
}
export async function reviseSalaryStructure(client, c, id) {
  need(c, MANAGE);
  const s = await loadStructure(client, c, id, true);
  if (!["active", "inactive"].includes(s.status)) throw new HrError(409, "Only an active structure can be revised.", "HR_STRUCTURE_STATE");
  const open = await qx(client, `SELECT 1 FROM tenant.hr_salary_structures WHERE organization_id=$1 AND company_id=$2 AND code=$3 AND status IN ('draft','pending_approval')`, [c.organizationId, c.companyId, s.code]);
  if (open.rows[0]) throw new HrError(409, "There is already a version of this structure being prepared.", "HR_STRUCTURE_OPEN");
  const next = (await qx(client, `SELECT max(version)+1 AS v FROM tenant.hr_salary_structures WHERE organization_id=$1 AND company_id=$2 AND code=$3`, [c.organizationId, c.companyId, s.code])).rows[0].v;
  const { rows } = await qx(client, `INSERT INTO tenant.hr_salary_structures(organization_id,company_id,code,name,version,status,currency_code,pay_frequency,created_by,supersedes_id,notes) VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9,$10) RETURNING *`, [c.organizationId, c.companyId, s.code, s.name, next, s.currency_code, s.pay_frequency, c.userId, s.id, s.notes]);
  await qx(client, `INSERT INTO tenant.hr_salary_structure_lines(organization_id,salary_structure_id,salary_component_id,sequence,amount,percentage,formula,minimum_amount,maximum_amount,percent_of,is_balance) SELECT organization_id,$2,salary_component_id,sequence,amount,percentage,formula,minimum_amount,maximum_amount,percent_of,is_balance FROM tenant.hr_salary_structure_lines WHERE salary_structure_id=$1`, [s.id, rows[0].id]);
  return { ...rows[0], lines: await loadLines(client, rows[0].id) };
}
export async function obsoleteSalaryStructure(client, c, id, reason) {
  need(c, MANAGE);
  const s = await loadStructure(client, c, id, true);
  if (!text(reason)) throw new HrError(400, "Give a reason.", "HR_REASON_REQUIRED");
  if (!["active", "inactive", "draft"].includes(s.status)) throw new HrError(409, "That structure cannot be retired.", "HR_STRUCTURE_STATE");
  const users = await qx(client, `SELECT count(*)::int AS n FROM tenant.hr_employee_compensation WHERE salary_structure_id=$1 AND status IN ('active','pending_approval') AND (effective_to IS NULL OR effective_to >= current_date)`, [s.id]);
  if (users.rows[0].n > 0) throw new HrError(409, `${users.rows[0].n} employee(s) are paid on this structure. Move them to another one first.`, "HR_STRUCTURE_IN_USE");
  const { rows } = await qx(client, `UPDATE tenant.hr_salary_structures SET status='obsolete', notes=coalesce(notes,'') || $2 WHERE id=$1 RETURNING *`, [s.id, `\nRetired: ${text(reason, 300)}`]);
  return rows[0];
}

// Monthly breakup of a CTC on a structure (F421/F422). Pure: same inputs, same outputs.
export function computeBreakup(lines, annualCtc, { employerCost = 0 } = {}) {
  const monthlyCtc = round2(Number(annualCtc) / 12);
  const vars = { CTC: monthlyCtc };
  const out = [];
  const ordered = [...lines].sort((a, b) => a.sequence - b.sequence);
  for (const l of ordered) {
    if (l.calculation_type === "statutory") { out.push({ code: l.component_code, name: l.component_name, type: l.component_type, kind: l.component_kind, amount: 0, statutory: true, taxable: l.taxable, prorated: l.prorated, pf_wage: l.pf_wage, esic_wage: l.esic_wage }); continue; }
    if (l.is_balance) continue;
    let v;
    if (l.formula) v = evaluateExpression(l.formula, vars);
    else if (l.percentage !== null && l.percentage !== undefined) v = ((l.percent_of && l.percent_of !== "CTC" ? vars[l.percent_of] : monthlyCtc) * Number(l.percentage)) / 100;
    else v = Number(l.amount ?? 0);
    if (l.minimum_amount !== null && l.minimum_amount !== undefined) v = Math.max(v, Number(l.minimum_amount));
    if (l.maximum_amount !== null && l.maximum_amount !== undefined) v = Math.min(v, Number(l.maximum_amount));
    v = round2(v);
    vars[l.component_code] = v;
    out.push({ code: l.component_code, name: l.component_name, type: l.component_type, kind: l.component_kind, amount: v, taxable: l.taxable, prorated: l.prorated, pf_wage: l.pf_wage, esic_wage: l.esic_wage });
  }
  const balance = ordered.find((l) => l.is_balance);
  const earnings = out.filter((o) => o.type === "earning").reduce((n, o) => n + o.amount, 0);
  const employer = out.filter((o) => o.type === "employer_contribution").reduce((n, o) => n + o.amount, 0) + Number(employerCost);
  if (balance) {
    const v = round2(monthlyCtc - earnings - employer);
    if (v < 0) throw new HrError(400, `The other components add up to more than the monthly CTC (${monthlyCtc}); ${balance.component_code} would be negative.`, "HR_STRUCTURE_EXCEEDS_CTC");
    out.push({ code: balance.component_code, name: balance.component_name, type: balance.component_type, kind: balance.component_kind, amount: v, taxable: balance.taxable, prorated: balance.prorated, pf_wage: balance.pf_wage, esic_wage: balance.esic_wage });
  }
  const gross = round2(out.filter((o) => o.type === "earning").reduce((n, o) => n + o.amount, 0));
  const employerTotal = round2(out.filter((o) => o.type === "employer_contribution").reduce((n, o) => n + o.amount, 0));
  const fixedDeductions = round2(out.filter((o) => o.type === "deduction").reduce((n, o) => n + o.amount, 0));
  return { monthlyCtc, components: out, monthlyGross: gross, monthlyEmployerContributions: employerTotal, monthlyFixedDeductions: fixedDeductions, annualCtc: round2(Number(annualCtc)) };
}
export async function previewSalaryStructure(client, c, input) {
  needAny(c, SEE);
  const s = await loadStructure(client, c, input.structureId);
  const ctc = Number(input.annualCtc);
  if (!(ctc > 0)) throw new HrError(400, "Enter an annual CTC above zero.", "HR_CTC_INVALID");
  return { structure: { id: s.id, code: s.code, version: s.version, status: s.status }, ...computeBreakup(await loadLines(client, s.id), ctc) };
}

// ---------------------------------------------------------------- compensation assignment (F422)
export async function compensationOn(client, employeeId, date) {
  return (await qx(client, `SELECT * FROM tenant.hr_employee_compensation WHERE employee_id=$1 AND status='active' AND effective_from <= $2 AND (effective_to IS NULL OR effective_to >= $2) ORDER BY effective_from DESC LIMIT 1`, [employeeId, date])).rows[0] ?? null;
}
export async function compensationDuring(client, employeeId, from, to) {
  return (await qx(client, `SELECT * FROM tenant.hr_employee_compensation WHERE employee_id=$1 AND status='active' AND effective_from <= $3 AND (effective_to IS NULL OR effective_to >= $2) ORDER BY effective_from`, [employeeId, from, to])).rows;
}

export async function listCompensation(client, c, filters = {}) {
  needAny(c, SEE);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.employeeId) { params.push(uuid(filters.employeeId, "Employee")); extra += ` AND k.employee_id=$${params.length}`; }
  if (filters.status) { params.push(String(filters.status)); extra += ` AND k.status=$${params.length}`; }
  const { rows } = await qx(client, `SELECT k.*, e.employee_number, trim(e.first_name || ' ' || e.last_name) AS employee_name, s.code AS structure_code, s.name AS structure_name FROM tenant.hr_employee_compensation k JOIN tenant.hr_employees e ON e.id=k.employee_id JOIN tenant.hr_salary_structures s ON s.id=k.salary_structure_id WHERE k.organization_id=$1 AND k.company_id=$2${extra} ORDER BY e.employee_number, k.effective_from DESC LIMIT 1000`, params);
  return rows;
}

export async function proposeCompensation(client, c, input) {
  need(c, MANAGE);
  const e = (await qx(client, `SELECT * FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, uuid(input.employeeId, "Employee")])).rows[0];
  if (!e) throw new HrError(404, "Employee was not found.", "HR_EMPLOYEE_NOT_FOUND");
  if (!["draft", "active", "on_leave", "on_notice", "suspended"].includes(e.status)) throw new HrError(409, "A separated employee's pay cannot be changed.", "HR_EMPLOYEE_CLOSED");
  const s = await loadStructure(client, c, input.structureId);
  if (s.status !== "active") throw new HrError(409, "Choose an approved (active) salary structure.", "HR_STRUCTURE_STATE");
  const ctc = Number(input.annualCtc);
  if (!(ctc > 0) || ctc > 1e10) throw new HrError(400, "Enter an annual CTC above zero.", "HR_CTC_INVALID");
  const from = dateRequired(input.effectiveFrom, "Effective from");
  if (from < String(e.joining_date).slice(0, 10)) throw new HrError(400, "The effective date is before the employee joined.", "HR_COMPENSATION_INVALID");
  const open = await qx(client, `SELECT 1 FROM tenant.hr_employee_compensation WHERE employee_id=$1 AND status='pending_approval'`, [e.id]);
  if (open.rows[0]) throw new HrError(409, "There is already a compensation change awaiting approval for this employee.", "HR_COMPENSATION_OPEN");
  const cur = await compensationOn(client, e.id, from);
  if (cur && cur.effective_from >= from) throw new HrError(409, `The new pay must start after the current pay, which began on ${cur.effective_from}.`, "HR_COMPENSATION_ORDER");
  const later = await qx(client, `SELECT effective_from FROM tenant.hr_employee_compensation WHERE employee_id=$1 AND status='active' AND effective_from > $2 LIMIT 1`, [e.id, from]);
  if (later.rows[0]) throw new HrError(409, `Pay is already set from ${later.rows[0].effective_from}, which is after this date.`, "HR_COMPENSATION_ORDER");
  const breakup = computeBreakup(await loadLines(client, s.id), ctc);
  const cfg = (await qx(client, `SELECT default_currency_code FROM tenant.hr_payroll_settings WHERE organization_id=$1 AND company_id=$2`, [c.organizationId, c.companyId])).rows[0];
  try {
    const { rows } = await qx(client, `INSERT INTO tenant.hr_employee_compensation(organization_id,company_id,employee_id,salary_structure_id,effective_from,annual_ctc,monthly_gross,currency_code,created_by,requested_by,status,breakup,structure_version,reason,source_change_id,source_offer_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,'pending_approval',$10::jsonb,$11,$12,$13,$14) RETURNING *`,
      [c.organizationId, c.companyId, e.id, s.id, from, ctc, breakup.monthlyGross, cfg?.default_currency_code ?? "INR", c.userId, JSON.stringify(breakup), s.version, textOrNull(input.reason, 500), uuidOrNull(input.sourceChangeId, "Change"), uuidOrNull(input.sourceOfferId, "Offer")]);
    await recordEvent(client, c, "employee", e.id, "hr.compensation.proposed", { from, annualCtc: ctc });
    return rows[0];
  } catch (err) {
    if (err.code === "23505") throw new HrError(409, "There is already pay set from that date for this employee.", "HR_COMPENSATION_OPEN");
    throw err;
  }
}
export async function decideCompensation(client, c, id, { approve, note }) {
  need(c, MANAGE);
  if (!canSeeSensitive(c)) throw new HrError(403, "Approving pay needs the sensitive-data permission.", "HR_SENSITIVE_FORBIDDEN");
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_employee_compensation WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Compensation")]);
  const k = rows[0];
  if (!k) throw new HrError(404, "Compensation was not found.", "HR_COMPENSATION_NOT_FOUND");
  if (k.status !== "pending_approval") throw new HrError(409, "Only pay awaiting approval can be decided.", "HR_COMPENSATION_STATE");
  const e = (await qx(client, `SELECT user_id FROM tenant.hr_employees WHERE id=$1`, [k.employee_id])).rows[0];
  if (k.requested_by === c.userId || e?.user_id === c.userId) throw new HrError(403, "Pay must be approved by someone other than the person who proposed it, and never by the employee it is for.", "SELF_APPROVAL_BLOCKED");
  if (!approve && !text(note)) throw new HrError(400, "Give a reason for rejecting.", "HR_REASON_REQUIRED");
  if (!approve) {
    const out = await qx(client, `UPDATE tenant.hr_employee_compensation SET status='rejected', decision_note=$2 WHERE id=$1 RETURNING *`, [k.id, text(note)]);
    return out.rows[0];
  }
  const cur = await compensationOn(client, k.employee_id, k.effective_from);
  if (cur && cur.effective_from >= k.effective_from) throw new HrError(409, "Pay has changed since this was proposed. Propose it again.", "HR_COMPENSATION_ORDER");
  await qx(client, `UPDATE tenant.hr_employee_compensation SET effective_to=$2::date - 1 WHERE employee_id=$1 AND status='active' AND effective_to IS NULL AND effective_from < $2`, [k.employee_id, k.effective_from]);
  const out = await qx(client, `UPDATE tenant.hr_employee_compensation SET status='active', approved_by=$2, approved_at=now(), decision_note=$3 WHERE id=$1 RETURNING *`, [k.id, c.userId, textOrNull(note)]);
  await recordEvent(client, c, "employee", k.employee_id, "hr.compensation.approved", { compensationId: k.id, from: k.effective_from });
  if (COMPENSATION_HOOKS.afterApprove) await COMPENSATION_HOOKS.afterApprove({ client, c, compensation: out.rows[0] });
  return out.rows[0];
}
export async function getMyCompensation(client, c) {
  const own = await ownEmployee(client, c);
  if (!own) throw new HrError(404, "Your user is not linked to an employee record. Ask HR to link it.", "HR_NO_EMPLOYEE_PROFILE");
  const cur = await compensationOn(client, own.id, today());
  return cur ? { effectiveFrom: cur.effective_from, annualCtc: cur.annual_ctc, monthlyGross: cur.monthly_gross, currency: cur.currency_code, components: cur.breakup?.components ?? [] } : null;
}
void has; void hasAny; void addDays;
