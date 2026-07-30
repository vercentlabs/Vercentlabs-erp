import {
  ACCOUNTING_PERMISSIONS,
  AccountingError,
  allocateNumber,
  asDatabaseDecimal,
  currency,
  decimal,
  event,
  getPrimaryLedger,
  isoDate,
  loadCompany,
  requirePermission,
  requiredText,
  text,
  toBaseAmount,
  uuid,
} from "./core.js";

export async function createCashForecastScenario(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.budgetManage);
  const company = await loadCompany(client, context, input.companyId || context.activeCompanyId);
  const ledger = await getPrimaryLedger(client, context, company.id, input.ledgerId);
  const startDate = isoDate(input.startDate, "Forecast start date");
  const endDate = isoDate(input.endDate, "Forecast end date");
  if (startDate > endDate) throw new AccountingError(400, "Forecast start date must be before the end date.");
  const code = text(input.code, 50) || await allocateNumber(client, context.organizationId, "accounting_cash_forecast");
  const result = await client.query(
    `INSERT INTO tenant.accounting_cash_forecast_scenarios (
      organization_id,company_id,ledger_id,code,name,start_date,end_date,currency_code,
      include_open_receivables,include_open_payables,include_recurring,status,created_by,updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft',$12,$12) RETURNING *`,
    [context.organizationId, company.id, ledger.id, code, requiredText(input.name, "Forecast name", 200),
      startDate, endDate, currency(input.currencyCode || company.base_currency), input.includeOpenReceivables !== false,
      input.includeOpenPayables !== false, input.includeRecurring !== false, context.userId],
  );
  await event(
    client,
    context,
    "cash_forecast",
    result.rows[0].id,
    "accounting.cash_forecast.created",
    null,
    "draft",
    { code: result.rows[0].code },
  );
  return result.rows[0];
}

export async function generateCashForecast(client, context, idValue, input = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.budgetManage);
  const id = uuid(idValue, "Cash forecast");
  const current = await client.query(`SELECT * FROM tenant.accounting_cash_forecast_scenarios WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [context.organizationId, id]);
  const scenario = current.rows[0];
  if (!scenario) throw new AccountingError(404, "Cash forecast scenario was not found.");
  if (!context.allowAllCompanies && context.activeCompanyId && scenario.company_id !== context.activeCompanyId) throw new AccountingError(403, "Switch to the forecast company before generating it.");
  await client.query(`DELETE FROM tenant.accounting_cash_forecast_lines WHERE organization_id=$1 AND scenario_id=$2`, [context.organizationId, id]);
  if (scenario.include_open_receivables) {
    await client.query(
      `INSERT INTO tenant.accounting_cash_forecast_lines (
        organization_id,scenario_id,forecast_date,source_type,source_id,direction,amount,base_amount,probability,category,description,metadata
       )
       SELECT schedule.organization_id,$2,schedule.due_date,'customer_invoice',invoice.id,'inflow',schedule.outstanding_amount,
         schedule.outstanding_amount*invoice.exchange_rate,COALESCE((invoice.customer_snapshot->>'collectionProbability')::numeric,100),
         'receivables','Customer invoice '||invoice.invoice_number,jsonb_build_object('partyId',invoice.party_id,'invoiceNumber',invoice.invoice_number)
       FROM tenant.accounting_customer_invoice_schedules schedule
       JOIN tenant.accounting_customer_invoices invoice ON invoice.organization_id=schedule.organization_id AND invoice.id=schedule.customer_invoice_id
       WHERE schedule.organization_id=$1 AND invoice.company_id=$3 AND invoice.ledger_id=$4
         AND schedule.outstanding_amount>0 AND schedule.due_date BETWEEN $5::date AND $6::date
         AND invoice.status IN ('posted','partially_paid','overdue','disputed')`,
      [context.organizationId, id, scenario.company_id, scenario.ledger_id, scenario.start_date, scenario.end_date],
    );
  }
  if (scenario.include_open_payables) {
    await client.query(
      `INSERT INTO tenant.accounting_cash_forecast_lines (
        organization_id,scenario_id,forecast_date,source_type,source_id,direction,amount,base_amount,probability,category,description,metadata
       )
       SELECT schedule.organization_id,$2,schedule.due_date,'vendor_bill',bill.id,'outflow',schedule.outstanding_amount,
         schedule.outstanding_amount*bill.exchange_rate,100,'payables','Vendor bill '||bill.bill_number,
         jsonb_build_object('partyId',bill.party_id,'billNumber',bill.bill_number)
       FROM tenant.accounting_vendor_bill_schedules schedule
       JOIN tenant.accounting_vendor_bills bill ON bill.organization_id=schedule.organization_id AND bill.id=schedule.vendor_bill_id
       WHERE schedule.organization_id=$1 AND bill.company_id=$3 AND bill.ledger_id=$4
         AND schedule.outstanding_amount>0 AND schedule.due_date BETWEEN $5::date AND $6::date
         AND bill.status IN ('posted','partially_paid','overdue','disputed')`,
      [context.organizationId, id, scenario.company_id, scenario.ledger_id, scenario.start_date, scenario.end_date],
    );
  }
  if (Array.isArray(input.manualLines)) {
    for (const line of input.manualLines) {
      const amount = decimal(line.amount || 0);
      if (amount < 0n) throw new AccountingError(400, "Forecast line amount cannot be negative.");
      await client.query(
        `INSERT INTO tenant.accounting_cash_forecast_lines (
          organization_id,scenario_id,forecast_date,source_type,direction,amount,base_amount,probability,category,description,metadata
         ) VALUES ($1,$2,$3,'manual',$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        [context.organizationId, id, isoDate(line.forecastDate, "Forecast date"), line.direction === "outflow" ? "outflow" : "inflow",
          asDatabaseDecimal(amount), asDatabaseDecimal(toBaseAmount(amount, line.exchangeRate || 1, 6)),
          Math.max(0, Math.min(100, Number(line.probability ?? 100))), text(line.category, 100) || "manual",
          requiredText(line.description, "Forecast line description", 500), JSON.stringify(line.metadata || {})],
      );
    }
  }
  const updated = await client.query(`UPDATE tenant.accounting_cash_forecast_scenarios SET status='generated',generated_at=now(),generated_by=$3,updated_by=$3 WHERE organization_id=$1 AND id=$2 RETURNING *`, [context.organizationId, id, context.userId]);
  await event(client, context, "cash_forecast", id, "accounting.cash_forecast.generated", scenario.status, "generated", {});
  return getCashForecast(client, context, id);
}

export async function getCashForecast(client, context, idValue) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const id = uuid(idValue, "Cash forecast");
  const scenario = await client.query(`SELECT scenario.*,company.name AS company_name FROM tenant.accounting_cash_forecast_scenarios scenario JOIN public.companies company ON company.id=scenario.company_id WHERE scenario.organization_id=$1 AND scenario.id=$2`, [context.organizationId, id]);
  if (!scenario.rows[0]) throw new AccountingError(404, "Cash forecast scenario was not found.");
  const lines = await client.query(
    `SELECT *,amount*probability/100 AS weighted_amount,base_amount*probability/100 AS weighted_base_amount
     FROM tenant.accounting_cash_forecast_lines WHERE organization_id=$1 AND scenario_id=$2 ORDER BY forecast_date,direction,description`,
    [context.organizationId, id],
  );
  return { scenario: scenario.rows[0], lines: lines.rows };
}

export async function listCashForecasts(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.reportsView);
  const values = [context.organizationId]; let where = "";
  if (!context.allowAllCompanies && context.activeCompanyId) { values.push(context.activeCompanyId); where += ` AND scenario.company_id=$${values.length}`; }
  if (filters.status && filters.status !== "all") { values.push(text(filters.status, 30)); where += ` AND scenario.status=$${values.length}`; }
  const result = await client.query(
    `SELECT scenario.*,company.name AS company_name,
      COALESCE(sum(line.base_amount*line.probability/100) FILTER (WHERE line.direction='inflow'),0) AS weighted_inflows,
      COALESCE(sum(line.base_amount*line.probability/100) FILTER (WHERE line.direction='outflow'),0) AS weighted_outflows
     FROM tenant.accounting_cash_forecast_scenarios scenario
     JOIN public.companies company ON company.id=scenario.company_id
     LEFT JOIN tenant.accounting_cash_forecast_lines line ON line.organization_id=scenario.organization_id AND line.scenario_id=scenario.id
     WHERE scenario.organization_id=$1${where}
     GROUP BY scenario.id,company.name ORDER BY scenario.start_date DESC,scenario.created_at DESC`, values);
  return result.rows;
}
