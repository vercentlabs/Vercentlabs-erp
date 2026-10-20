// HR & Payroll — statutory rules (EPF, ESI, Professional Tax, TDS) as verified, versioned rule families, their calculation, opening
// year-to-date pay, and variable pay (MVP 38).
export { ST as PAYROLL_STATUTORY_PERMISSIONS, TEMPLATES as PAYROLL_STATUTORY_TEMPLATES, financialYearOf } from "./st-rules.js";
export { createStatutoryRule, listStatutoryRules, listStatutoryTemplates, listYtdOpenings, retireStatutoryRule, saveYtdOpening, updateStatutoryRule, verifyStatutoryRule } from "./st-commands.js";
export { computeStatutory, incomeTax } from "./st-engine.js";
export { cancelPayrollInput, createPayrollInput, decidePayrollInput, listPayrollInputs } from "./vp-inputs.js";
