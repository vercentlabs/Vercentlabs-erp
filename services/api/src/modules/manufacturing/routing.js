import { MfgError, dateOrNull, has, need, nonNegative, positive, recordEvent, text, uuid } from "./common.js";

// Process definition: work centres, shift calendars, routings and the capacity they give
// (F150-F154). A routing is versioned like a BOM (edit a draft; revise an active one); a work
// centre's daily capacity is its calendar's shift hours x machines x efficiency, less closures.
const CENTER_TYPES = ["machine", "labor", "cell", "subcontract"];
const CENTER_STATUSES = ["active", "inactive", "maintenance"];
const WEEKDAYS = new Set([0, 1, 2, 3, 4, 5, 6]);

// Rates are cost information: without manufacturing.costing.view they are removed here.
const seeCost = (c) => has(c, "manufacturing.costing.view");

// ---------------------------------------------------------------- calendars (F154)
export async function saveCalendar(client, c, input = {}) {
  need(c, "manufacturing.settings.manage");
  const code = text(input.code, 60).toUpperCase();
  if (!code || !text(input.name, 200)) throw new MfgError(400, "A calendar needs a code and a name.", "MFG_CODE_REQUIRED");
  const weekdays = input.workingWeekdays === undefined ? [1, 2, 3, 4, 5] : [...new Set((Array.isArray(input.workingWeekdays) ? input.workingWeekdays : []).map(Number))];
  if (!weekdays.length || weekdays.some((d) => !WEEKDAYS.has(d))) throw new MfgError(400, "Working weekdays must be numbers 0 (Sunday) to 6 (Saturday), at least one.", "MFG_WEEKDAYS_INVALID");
  const existing = (await client.query(`SELECT id FROM tenant.manufacturing_calendars WHERE organization_id=$1 AND company_id=$2 AND code=$3`, [c.organizationId, c.companyId, code])).rows[0];
  const { rows } = existing
    ? await client.query(`UPDATE tenant.manufacturing_calendars SET name=$3,working_weekdays=$4,status=$5,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, existing.id, text(input.name, 200), weekdays, input.status === "inactive" ? "inactive" : "active"])
    : await client.query(`INSERT INTO tenant.manufacturing_calendars(organization_id,company_id,code,name,working_weekdays,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [c.organizationId, c.companyId, code, text(input.name, 200), weekdays, c.userId]);
  return rows[0];
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
export async function addShift(client, c, input = {}) {
  need(c, "manufacturing.settings.manage");
  const calendarId = uuid(input.calendarId, "Calendar");
  const calendar = (await client.query(`SELECT id FROM tenant.manufacturing_calendars WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, calendarId])).rows[0];
  if (!calendar) throw new MfgError(404, "Calendar was not found.", "MFG_CALENDAR_NOT_FOUND");
  const start = String(input.startTime || "");
  const end = String(input.endTime || "");
  if (!TIME.test(start) || !TIME.test(end)) throw new MfgError(400, "Start and end times must be HH:MM.", "MFG_TIME_INVALID");
  if (end <= start) throw new MfgError(400, "A shift must end after it starts.", "MFG_TIME_INVALID");
  const breakMinutes = Math.trunc(nonNegative(input.breakMinutes, "Break minutes"));
  const length = (Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5))) - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)));
  if (breakMinutes >= length) throw new MfgError(400, "The break must be shorter than the shift.", "MFG_TIME_INVALID");
  // shifts on one calendar must not overlap
  const overlap = (await client.query(`SELECT name FROM tenant.manufacturing_shifts WHERE organization_id=$1 AND calendar_id=$2 AND start_time<$4::time AND end_time>$3::time`, [c.organizationId, calendarId, start, end])).rows[0];
  if (overlap) throw new MfgError(409, `That shift overlaps ${overlap.name}.`, "MFG_SHIFT_OVERLAP");
  try {
    const { rows } = await client.query(`INSERT INTO tenant.manufacturing_shifts(organization_id,calendar_id,name,start_time,end_time,break_minutes) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [c.organizationId, calendarId, text(input.name, 100) || "Shift", start, end, breakMinutes]);
    return rows[0];
  } catch (error) {
    if (error.code === "23505") throw new MfgError(409, "A shift with that name already exists on this calendar.", "MFG_SHIFT_DUPLICATE");
    throw error;
  }
}

export async function removeShift(client, c, shiftId) {
  need(c, "manufacturing.settings.manage");
  const { rowCount } = await client.query(`DELETE FROM tenant.manufacturing_shifts s USING tenant.manufacturing_calendars cal WHERE s.organization_id=$1 AND s.id=$2 AND cal.id=s.calendar_id AND cal.company_id=$3`, [c.organizationId, uuid(shiftId, "Shift"), c.companyId]);
  if (!rowCount) throw new MfgError(404, "Shift was not found.", "MFG_SHIFT_NOT_FOUND");
  return { removed: true };
}

export async function addCalendarException(client, c, input = {}) {
  need(c, "manufacturing.settings.manage");
  const calendarId = uuid(input.calendarId, "Calendar");
  const calendar = (await client.query(`SELECT id FROM tenant.manufacturing_calendars WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, calendarId])).rows[0];
  if (!calendar) throw new MfgError(404, "Calendar was not found.", "MFG_CALENDAR_NOT_FOUND");
  const day = dateOrNull(input.exceptionDate, "Date");
  if (!day) throw new MfgError(400, "A date is required.", "MFG_DATE_INVALID");
  if (!text(input.name, 200)) throw new MfgError(400, "Name the holiday or closure.", "MFG_NAME_REQUIRED");
  const { rows } = await client.query(
    `INSERT INTO tenant.manufacturing_calendar_exceptions(organization_id,calendar_id,exception_date,is_working,name) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT (calendar_id,exception_date) DO UPDATE SET is_working=EXCLUDED.is_working,name=EXCLUDED.name RETURNING *`,
    [c.organizationId, calendarId, day, input.isWorking === true, text(input.name, 200)],
  );
  return rows[0];
}

export async function removeCalendarException(client, c, exceptionId) {
  need(c, "manufacturing.settings.manage");
  const { rowCount } = await client.query(`DELETE FROM tenant.manufacturing_calendar_exceptions e USING tenant.manufacturing_calendars cal WHERE e.organization_id=$1 AND e.id=$2 AND cal.id=e.calendar_id AND cal.company_id=$3`, [c.organizationId, uuid(exceptionId, "Exception"), c.companyId]);
  if (!rowCount) throw new MfgError(404, "Exception was not found.", "MFG_EXCEPTION_NOT_FOUND");
  return { removed: true };
}

export async function listCalendars(client, c) {
  need(c, "manufacturing.view");
  const { rows } = await client.query(
    `SELECT cal.id,cal.code,cal.name,cal.working_weekdays,cal.status,
            COALESCE((SELECT sum(EXTRACT(EPOCH FROM (s.end_time-s.start_time))/60-s.break_minutes) FROM tenant.manufacturing_shifts s WHERE s.calendar_id=cal.id),0)::int AS daily_minutes,
            (SELECT count(*)::int FROM tenant.manufacturing_shifts s WHERE s.calendar_id=cal.id) AS shift_count,
            (SELECT count(*)::int FROM tenant.manufacturing_calendar_exceptions e WHERE e.calendar_id=cal.id) AS exception_count
       FROM tenant.manufacturing_calendars cal WHERE cal.organization_id=$1 AND cal.company_id=$2 ORDER BY cal.code`,
    [c.organizationId, c.companyId],
  );
  return rows;
}
export async function listShifts(client, c) {
  need(c, "manufacturing.view");
  const { rows } = await client.query(
    `SELECT s.id,s.name,s.start_time::text AS start_time,s.end_time::text AS end_time,s.break_minutes,cal.code AS calendar_code,cal.name AS calendar_name,
            (EXTRACT(EPOCH FROM (s.end_time-s.start_time))/60-s.break_minutes)::int AS working_minutes
       FROM tenant.manufacturing_shifts s JOIN tenant.manufacturing_calendars cal ON cal.id=s.calendar_id WHERE s.organization_id=$1 AND cal.company_id=$2 ORDER BY cal.code,s.start_time`,
    [c.organizationId, c.companyId],
  );
  return rows;
}
export async function listCalendarExceptions(client, c) {
  need(c, "manufacturing.view");
  const { rows } = await client.query(
    `SELECT e.id,e.exception_date,e.is_working,e.name,cal.code AS calendar_code,cal.name AS calendar_name FROM tenant.manufacturing_calendar_exceptions e JOIN tenant.manufacturing_calendars cal ON cal.id=e.calendar_id
      WHERE e.organization_id=$1 AND cal.company_id=$2 ORDER BY e.exception_date DESC LIMIT 500`,
    [c.organizationId, c.companyId],
  );
  return rows;
}

// ---------------------------------------------------------------- work centres (F152, F153)
export async function saveWorkCenter(client, c, input = {}) {
  need(c, "manufacturing.routing.manage");
  const id = input.id ? uuid(input.id, "Work centre") : null;
  const current = id ? (await client.query(`SELECT * FROM tenant.manufacturing_work_centers WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, id])).rows[0] : null;
  if (id && !current) throw new MfgError(404, "Work centre was not found.", "MFG_WORK_CENTER_NOT_FOUND");
  const code = current ? current.code : text(input.code, 60).toUpperCase();
  const name = input.name === undefined ? current?.name : text(input.name, 200);
  if (!code || !name) throw new MfgError(400, "A work centre needs a code and a name.", "MFG_CODE_REQUIRED");
  const status = input.status === undefined ? current?.status ?? "active" : String(input.status);
  if (!CENTER_STATUSES.includes(status)) throw new MfgError(400, "Status must be active, inactive or maintenance.", "MFG_STATUS_INVALID");
  const type = input.centerType === undefined ? current?.center_type ?? "machine" : String(input.centerType);
  if (!CENTER_TYPES.includes(type)) throw new MfgError(400, `Type must be one of: ${CENTER_TYPES.join(", ")}.`, "MFG_TYPE_INVALID");
  const machines = input.machineCount === undefined ? current?.machine_count ?? 1 : Math.trunc(Number(input.machineCount));
  if (!Number.isFinite(machines) || machines < 1) throw new MfgError(400, "A work centre has at least one machine or station.", "MFG_MACHINES_INVALID");
  const efficiency = input.efficiencyPercent === undefined ? Number(current?.efficiency_percent ?? 100) : Number(input.efficiencyPercent);
  if (!Number.isFinite(efficiency) || efficiency <= 0 || efficiency > 200) throw new MfgError(400, "Efficiency must be above 0 and at most 200 percent.", "MFG_EFFICIENCY_INVALID");
  const hourly = input.hourlyRate === undefined ? Number(current?.hourly_rate ?? 0) : nonNegative(input.hourlyRate, "Hourly rate");
  const overhead = input.overheadRate === undefined ? Number(current?.overhead_rate ?? 0) : nonNegative(input.overheadRate, "Overhead rate");
  let calendarId = input.calendarId === undefined ? current?.calendar_id ?? null : input.calendarId ? uuid(input.calendarId, "Calendar") : null;
  if (calendarId) {
    const cal = (await client.query(`SELECT id FROM tenant.manufacturing_calendars WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='active'`, [c.organizationId, c.companyId, calendarId])).rows[0];
    if (!cal) throw new MfgError(404, "Calendar was not found.", "MFG_CALENDAR_NOT_FOUND");
  }
  if (current && status !== "active" && current.status === "active") {
    const open = (await client.query(`SELECT count(*)::int AS n FROM tenant.manufacturing_work_order_operations op JOIN tenant.manufacturing_work_orders wo ON wo.id=op.work_order_id WHERE op.organization_id=$1 AND op.work_center_id=$2 AND op.status IN ('pending','ready','in_progress') AND wo.status IN ('planned','released','in_progress')`, [c.organizationId, current.id])).rows[0].n;
    if (open && status === "inactive") throw new MfgError(409, `${open} open operation(s) are planned on this work centre; move or finish them before deactivating it.`, "MFG_WORK_CENTER_IN_USE");
  }
  const capacityPerDay = input.capacityPerDay === undefined ? current?.capacity_per_day ?? 0 : nonNegative(input.capacityPerDay, "Capacity per day", 0);
  if (current) {
    const { rows } = await client.query(
      `UPDATE tenant.manufacturing_work_centers SET name=$3,status=$4,center_type=$5,machine_count=$6,efficiency_percent=$7,hourly_rate=$8,overhead_rate=$9,calendar_id=$10,description=$11,capacity_per_day=$12,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
      [c.organizationId, current.id, name, status, type, machines, efficiency, hourly, overhead, calendarId, input.description === undefined ? current.description : text(input.description, 1000) || null, capacityPerDay],
    );
    return rows[0];
  }
  try {
    const { rows } = await client.query(
      `INSERT INTO tenant.manufacturing_work_centers(organization_id,company_id,code,name,status,center_type,machine_count,efficiency_percent,hourly_rate,overhead_rate,calendar_id,description,capacity_per_day,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [c.organizationId, c.companyId, code, name, status, type, machines, efficiency, hourly, overhead, calendarId, text(input.description, 1000) || null, capacityPerDay, c.userId],
    );
    return rows[0];
  } catch (error) {
    if (error.code === "23505") throw new MfgError(409, `Work centre ${code} already exists.`, "MFG_WORK_CENTER_DUPLICATE");
    throw error;
  }
}

export async function listWorkCenters(client, c) {
  need(c, "manufacturing.view");
  const { rows } = await client.query(
    `SELECT wc.id,wc.code,wc.name,wc.status,wc.center_type,wc.machine_count,wc.efficiency_percent::text AS efficiency_percent,wc.hourly_rate::text AS hourly_rate,wc.overhead_rate::text AS overhead_rate,wc.capacity_per_day::text AS capacity_per_day,wc.calendar_id,cal.code AS calendar_code,wc.description,
            COALESCE((SELECT sum(EXTRACT(EPOCH FROM (s.end_time-s.start_time))/60-s.break_minutes) FROM tenant.manufacturing_shifts s WHERE s.calendar_id=wc.calendar_id),0)::int AS shift_minutes
       FROM tenant.manufacturing_work_centers wc LEFT JOIN tenant.manufacturing_calendars cal ON cal.id=wc.calendar_id WHERE wc.organization_id=$1 AND wc.company_id=$2 ORDER BY wc.code`,
    [c.organizationId, c.companyId],
  );
  return rows.map((row) => ({ ...row, daily_minutes: Math.round(row.shift_minutes * row.machine_count * (Number(row.efficiency_percent) / 100)), ...(seeCost(c) ? {} : { hourly_rate: null, overhead_rate: null }) }));
}

// ---------------------------------------------------------------- routings (F150, F151)
async function loadRouting(client, c, id, { lock = false } = {}) {
  const { rows } = await client.query(`SELECT * FROM tenant.manufacturing_routings WHERE organization_id=$1 AND company_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`, [c.organizationId, c.companyId, uuid(id, "Routing")]);
  if (!rows[0]) throw new MfgError(404, "Routing was not found.", "MFG_ROUTING_NOT_FOUND");
  return rows[0];
}
const requireStatus = (routing, ...allowed) => {
  if (!allowed.includes(routing.status)) throw new MfgError(409, `This routing is ${routing.status}; that action needs it to be ${allowed.join(" or ")}.`, "MFG_ROUTING_STATE_INVALID");
};

async function cleanOperations(client, c, list) {
  if (!Array.isArray(list) || !list.length) throw new MfgError(400, "A routing needs at least one operation.", "MFG_OPERATIONS_REQUIRED");
  if (list.length > 200) throw new MfgError(400, "A routing can have at most 200 operations.", "MFG_OPERATIONS_TOO_MANY");
  const seen = new Set();
  const out = [];
  for (const [index, op] of list.entries()) {
    const sequence = op.sequence === undefined || op.sequence === "" ? (index + 1) * 10 : Math.trunc(Number(op.sequence));
    if (!Number.isFinite(sequence) || sequence <= 0) throw new MfgError(400, "Operation sequence must be a positive number.", "MFG_SEQUENCE_INVALID");
    if (seen.has(sequence)) throw new MfgError(409, `Sequence ${sequence} is used twice.`, "MFG_SEQUENCE_DUPLICATE");
    seen.add(sequence);
    if (!text(op.name, 200)) throw new MfgError(400, `Operation ${sequence} needs a name.`, "MFG_NAME_REQUIRED");
    let centerId = null;
    if (op.workCenterId) {
      centerId = uuid(op.workCenterId, "Work centre");
      const wc = (await client.query(`SELECT status FROM tenant.manufacturing_work_centers WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, centerId])).rows[0];
      if (!wc) throw new MfgError(404, "Work centre was not found.", "MFG_WORK_CENTER_NOT_FOUND");
      if (wc.status === "inactive") throw new MfgError(409, "An inactive work centre cannot be used in a routing.", "MFG_WORK_CENTER_INACTIVE");
    } else if (!op.subcontracted) {
      throw new MfgError(400, `Operation ${sequence} needs a work centre (or mark it subcontracted).`, "MFG_WORK_CENTER_REQUIRED");
    }
    out.push({ sequence, name: text(op.name, 200), centerId, setup: nonNegative(op.setupMinutes, "Setup minutes"), run: nonNegative(op.runMinutesPerUnit, "Run minutes per unit"), queue: nonNegative(op.queueMinutes, "Queue minutes"), move: nonNegative(op.moveMinutes, "Move minutes"), subcontracted: Boolean(op.subcontracted), instructions: text(op.instructions, 4000) || null, inspection: Boolean(op.inspectionRequired) });
  }
  return out.sort((a, b) => a.sequence - b.sequence);
}
async function insertOperations(client, c, routingId, ops) {
  for (const op of ops) {
    await client.query(
      `INSERT INTO tenant.manufacturing_routing_operations(organization_id,routing_id,sequence,name,work_center_id,setup_minutes,run_minutes_per_unit,queue_minutes,move_minutes,subcontracted,instructions,inspection_required) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [c.organizationId, routingId, op.sequence, op.name, op.centerId, op.setup, op.run, op.queue, op.move, op.subcontracted, op.instructions, op.inspection],
    );
  }
}

export async function createRouting(client, c, input = {}) {
  need(c, "manufacturing.routing.manage");
  const code = text(input.code, 80).toUpperCase();
  if (!code || !text(input.name, 200)) throw new MfgError(400, "A routing needs a code and a name.", "MFG_CODE_REQUIRED");
  const itemId = input.itemId ? uuid(input.itemId, "Product") : null;
  if (itemId) {
    const item = (await client.query(`SELECT id FROM tenant.items WHERE organization_id=$1 AND id=$2 AND status='active' AND (company_id IS NULL OR company_id=$3)`, [c.organizationId, itemId, c.companyId])).rows[0];
    if (!item) throw new MfgError(404, "Product was not found for the active company.", "MFG_ITEM_NOT_FOUND");
  }
  const ops = await cleanOperations(client, c, input.operations);
  const version = (await client.query(`SELECT COALESCE(max(version),0)+1 AS v FROM tenant.manufacturing_routings WHERE organization_id=$1 AND company_id=$2 AND code=$3`, [c.organizationId, c.companyId, code])).rows[0].v;
  const routing = (await client.query(`INSERT INTO tenant.manufacturing_routings(organization_id,company_id,code,name,version,status,created_by,item_id,notes) VALUES($1,$2,$3,$4,$5,'draft',$6,$7,$8) RETURNING *`, [c.organizationId, c.companyId, code, text(input.name, 200), version, c.userId, itemId, text(input.notes, 2000) || null])).rows[0];
  await insertOperations(client, c, routing.id, ops);
  await recordEvent(client, c, "routing", routing.id, "manufacturing.routing.created", { operations: ops.length });
  return routing;
}

export async function updateDraftRouting(client, c, routingId, input = {}) {
  need(c, "manufacturing.routing.manage");
  const routing = await loadRouting(client, c, routingId, { lock: true });
  requireStatus(routing, "draft");
  if (input.operations !== undefined) {
    const ops = await cleanOperations(client, c, input.operations);
    await client.query(`DELETE FROM tenant.manufacturing_routing_operations WHERE organization_id=$1 AND routing_id=$2`, [c.organizationId, routing.id]);
    await insertOperations(client, c, routing.id, ops);
  }
  const { rows } = await client.query(`UPDATE tenant.manufacturing_routings SET name=$3,notes=$4,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, routing.id, input.name === undefined ? routing.name : text(input.name, 200) || routing.name, input.notes === undefined ? routing.notes : text(input.notes, 2000) || null]);
  return rows[0];
}

export async function activateRouting(client, c, routingId) {
  need(c, "manufacturing.routing.manage");
  const routing = await loadRouting(client, c, routingId, { lock: true });
  requireStatus(routing, "draft");
  const count = (await client.query(`SELECT count(*)::int AS n FROM tenant.manufacturing_routing_operations WHERE organization_id=$1 AND routing_id=$2`, [c.organizationId, routing.id])).rows[0].n;
  if (!count) throw new MfgError(409, "A routing with no operations cannot be activated.", "MFG_OPERATIONS_REQUIRED");
  // one default routing per product: activating a new one retires the previous default
  if (routing.item_id) await client.query(`UPDATE tenant.manufacturing_routings SET status='inactive',is_default=false,updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND item_id=$3 AND status='active' AND id<>$4`, [c.organizationId, c.companyId, routing.item_id, routing.id]);
  const { rows } = await client.query(`UPDATE tenant.manufacturing_routings SET status='active',is_default=$3,approved_by=$4,approved_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, routing.id, Boolean(routing.item_id), c.userId]);
  await recordEvent(client, c, "routing", routing.id, "manufacturing.routing.activated", { version: routing.version });
  return rows[0];
}

export async function reviseRouting(client, c, routingId) {
  need(c, "manufacturing.routing.manage");
  const source = await loadRouting(client, c, routingId);
  requireStatus(source, "active", "inactive");
  const draft = (await client.query(`SELECT 1 FROM tenant.manufacturing_routings WHERE organization_id=$1 AND company_id=$2 AND code=$3 AND status='draft'`, [c.organizationId, c.companyId, source.code])).rows[0];
  if (draft) throw new MfgError(409, "This routing already has a draft revision.", "MFG_REVISION_IN_PROGRESS");
  const version = (await client.query(`SELECT max(version)+1 AS v FROM tenant.manufacturing_routings WHERE organization_id=$1 AND company_id=$2 AND code=$3`, [c.organizationId, c.companyId, source.code])).rows[0].v;
  const routing = (await client.query(`INSERT INTO tenant.manufacturing_routings(organization_id,company_id,code,name,version,status,created_by,item_id,notes,supersedes_routing_id) VALUES($1,$2,$3,$4,$5,'draft',$6,$7,$8,$9) RETURNING *`, [c.organizationId, c.companyId, source.code, source.name, version, c.userId, source.item_id, source.notes, source.id])).rows[0];
  await client.query(
    `INSERT INTO tenant.manufacturing_routing_operations(organization_id,routing_id,sequence,name,work_center_id,setup_minutes,run_minutes_per_unit,queue_minutes,move_minutes,subcontracted,instructions,inspection_required)
     SELECT organization_id,$2,sequence,name,work_center_id,setup_minutes,run_minutes_per_unit,queue_minutes,move_minutes,subcontracted,instructions,inspection_required FROM tenant.manufacturing_routing_operations WHERE organization_id=$1 AND routing_id=$3`,
    [c.organizationId, routing.id, source.id],
  );
  await recordEvent(client, c, "routing", routing.id, "manufacturing.routing.revised", { from: source.id, version });
  return routing;
}

export async function obsoleteRouting(client, c, routingId, reason) {
  need(c, "manufacturing.routing.manage");
  const routing = await loadRouting(client, c, routingId, { lock: true });
  requireStatus(routing, "active", "inactive");
  if (!text(reason, 1000)) throw new MfgError(400, "A reason is required to obsolete a routing.", "MFG_REASON_REQUIRED");
  const open = (await client.query(`SELECT count(*)::int AS n FROM tenant.manufacturing_work_orders WHERE organization_id=$1 AND routing_id=$2 AND status IN ('planned','released','in_progress')`, [c.organizationId, routing.id])).rows[0].n;
  if (open) throw new MfgError(409, `${open} open work order(s) use this routing.`, "MFG_ROUTING_IN_USE");
  const { rows } = await client.query(`UPDATE tenant.manufacturing_routings SET status='obsolete',is_default=false,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, [c.organizationId, routing.id]);
  return rows[0];
}

export async function listRoutings(client, c, { status = null } = {}) {
  need(c, "manufacturing.view");
  const values = [c.organizationId, c.companyId];
  let filter = "";
  if (status) { values.push(String(status)); filter = ` AND r.status=$${values.length}`; }
  const { rows } = await client.query(
    `SELECT r.id,r.code,r.name,r.version,r.status,r.is_default,r.created_at,r.approved_at,item.code AS item_code,item.name AS item_name,
            (SELECT count(*)::int FROM tenant.manufacturing_routing_operations o WHERE o.routing_id=r.id) AS operation_count,
            (SELECT COALESCE(sum(o.setup_minutes),0)::text FROM tenant.manufacturing_routing_operations o WHERE o.routing_id=r.id) AS setup_minutes,
            (SELECT COALESCE(sum(o.run_minutes_per_unit),0)::text FROM tenant.manufacturing_routing_operations o WHERE o.routing_id=r.id) AS run_minutes_per_unit
       FROM tenant.manufacturing_routings r LEFT JOIN tenant.items item ON item.id=r.item_id WHERE r.organization_id=$1 AND r.company_id=$2${filter} ORDER BY r.code,r.version DESC LIMIT 500`,
    values,
  );
  return rows;
}

export async function getRouting(client, c, routingId) {
  need(c, "manufacturing.view");
  const routing = await loadRouting(client, c, routingId);
  const item = routing.item_id ? (await client.query(`SELECT code,name FROM tenant.items WHERE id=$1`, [routing.item_id])).rows[0] : null;
  const operations = (
    await client.query(
      `SELECT o.id,o.sequence,o.name,o.work_center_id,wc.code AS work_center_code,wc.name AS work_center_name,o.setup_minutes::text AS setup_minutes,o.run_minutes_per_unit::text AS run_minutes_per_unit,o.queue_minutes::text AS queue_minutes,o.move_minutes::text AS move_minutes,o.subcontracted,o.instructions,o.inspection_required
         FROM tenant.manufacturing_routing_operations o LEFT JOIN tenant.manufacturing_work_centers wc ON wc.id=o.work_center_id WHERE o.organization_id=$1 AND o.routing_id=$2 ORDER BY o.sequence`,
      [c.organizationId, routing.id],
    )
  ).rows;
  const versions = (await client.query(`SELECT id,version,status,created_at FROM tenant.manufacturing_routings WHERE organization_id=$1 AND company_id=$2 AND code=$3 ORDER BY version DESC`, [c.organizationId, c.companyId, routing.code])).rows;
  return { ...routing, item_code: item?.code ?? null, item_name: item?.name ?? null, operations, versions };
}

// ---------------------------------------------------------------- capacity (F153)
// Available minutes per work centre per day (shifts x machines x efficiency; closures and non-working
// weekdays give none) against the minutes planned on open work orders starting that day.
export async function getCapacityPlan(client, c, { from = null, days = 14 } = {}) {
  need(c, "manufacturing.view");
  const start = dateOrNull(from, "From date") || new Date().toISOString().slice(0, 10);
  const span = Math.min(Math.max(Math.trunc(Number(days)) || 14, 1), 60);
  const { rows } = await client.query(
    `WITH span AS (SELECT generate_series($3::date,$3::date+($4::int-1),interval '1 day')::date AS day),
          centers AS (SELECT wc.id,wc.code,wc.name,wc.machine_count,wc.efficiency_percent,wc.calendar_id,wc.status FROM tenant.manufacturing_work_centers wc WHERE wc.organization_id=$1 AND wc.company_id=$2 AND wc.status<>'inactive')
     SELECT centers.id AS work_center_id,centers.code,centers.name,centers.status,span.day::text AS day,
            CASE WHEN centers.status='maintenance' THEN 0
                 WHEN centers.calendar_id IS NULL THEN 0
                 WHEN EXISTS (SELECT 1 FROM tenant.manufacturing_calendar_exceptions e WHERE e.calendar_id=centers.calendar_id AND e.exception_date=span.day AND NOT e.is_working) THEN 0
                 WHEN NOT (EXTRACT(DOW FROM span.day)::int = ANY(COALESCE((SELECT cal.working_weekdays FROM tenant.manufacturing_calendars cal WHERE cal.id=centers.calendar_id),'{}'::int[]))) AND NOT EXISTS (SELECT 1 FROM tenant.manufacturing_calendar_exceptions e WHERE e.calendar_id=centers.calendar_id AND e.exception_date=span.day AND e.is_working) THEN 0
                 ELSE round(COALESCE((SELECT sum(EXTRACT(EPOCH FROM (s.end_time-s.start_time))/60-s.break_minutes) FROM tenant.manufacturing_shifts s WHERE s.calendar_id=centers.calendar_id),0)*centers.machine_count*centers.efficiency_percent/100) END::int AS available_minutes,
            COALESCE((SELECT sum(op.planned_minutes) FROM tenant.manufacturing_work_order_operations op JOIN tenant.manufacturing_work_orders wo ON wo.id=op.work_order_id
                       WHERE op.organization_id=$1 AND op.work_center_id=centers.id AND op.status NOT IN ('completed','skipped') AND wo.status IN ('planned','released','in_progress') AND wo.planned_start_at::date=span.day),0)::int AS load_minutes
       FROM centers CROSS JOIN span ORDER BY centers.code,span.day`,
    [c.organizationId, c.companyId, start, span],
  );
  const byCenter = new Map();
  for (const row of rows) {
    const entry = byCenter.get(row.work_center_id) ?? { workCenterId: row.work_center_id, code: row.code, name: row.name, status: row.status, days: [], availableTotal: 0, loadTotal: 0 };
    entry.days.push({ day: row.day, available: row.available_minutes, load: row.load_minutes, utilization: row.available_minutes ? Math.round((row.load_minutes / row.available_minutes) * 100) : row.load_minutes ? null : 0 });
    entry.availableTotal += row.available_minutes;
    entry.loadTotal += row.load_minutes;
    byCenter.set(row.work_center_id, entry);
  }
  return { from: start, days: span, centers: [...byCenter.values()].map((e) => ({ ...e, utilization: e.availableTotal ? Math.round((e.loadTotal / e.availableTotal) * 100) : null, overloadedDays: e.days.filter((d) => d.load > d.available).length })) };
}
