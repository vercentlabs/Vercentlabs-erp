#!/usr/bin/env python3
from pathlib import Path
import csv
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
D = ROOT / "docs"
P = D / "00-program"
R = D / "02-register"
I = D / "08-implementation-plans"
errors = []

def err(msg): errors.append(msg)
def rows(path):
    if not path.exists():
        err("missing " + str(path.relative_to(ROOT)))
        return []
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))

required = [
    P / "SOLE_PROJECT_MANAGER_OPERATING_MODEL.md",
    P / "PROJECT_CAPACITY_PLAN.md",
    P / "SCHEDULE_MANAGEMENT_POLICY.md",
    P / "PROJECT_COST_MANAGEMENT_PLAN.md",
    P / "STAKEHOLDER_MANAGEMENT_PLAN.md",
    P / "COMMUNICATIONS_PLAN.md",
    P / "PROCUREMENT_EXTERNAL_SERVICES_PLAN.md",
    P / "PM_PLANNING_BASELINE.md",
    P / "CURRENT_REBUILD_CHECKPOINT.md",
    P / "PLANNING_CLOSURE_STATUS.md",
    P / "RAID_REGISTER.csv",
    R / "IMPLEMENTATION_SEQUENCE_BASELINE.csv",
    R / "PROJECT_COST_BASELINE.csv",
    R / "STAKEHOLDER_REGISTER.csv",
    R / "PM_PLANNING_BASELINE_REVIEW.csv",
    R / "IMPLEMENTATION_WAVE_REGISTER.csv",
    I / "IMPLEMENTATION_WAVES.csv",
]
for p in required:
    if not p.exists(): err("missing " + str(p.relative_to(ROOT)))

pm = rows(R / "PM_PLANNING_BASELINE_REVIEW.csv")
if len(pm) != 1:
    err("PM planning baseline review must contain exactly one row")
elif pm:
    r = pm[0]
    if r.get("review_status") != "APPROVED": err("PM planning baseline review is not APPROVED")
    if r.get("accountable_owner") != "Project Manager": err("PM baseline accountable owner must be Project Manager")
    if r.get("calendar_timeline_policy") != "NO_CALENDAR_TIMELINE_BASELINED": err("calendar timeline policy must be NO_CALENDAR_TIMELINE_BASELINED")
    if r.get("capacity_policy") != "WIP_ONE_NO_TIME_COMMITMENT": err("capacity policy must not introduce a time commitment")
    for key in ("planning_closure", "architecture_freeze", "implementation_authorization"):
        if r.get(key) != "PASS": err(f"PM baseline {key} must be PASS")

expected = ["T00", "T01"] + [f"W{i:02d}" for i in range(1, 16)]
authority = rows(R / "IMPLEMENTATION_WAVE_REGISTER.csv")
if [r.get("wave_id", "") for r in authority] != expected:
    err("canonical implementation-wave authority is not T00,T01,W01-W15")

seq = rows(R / "IMPLEMENTATION_SEQUENCE_BASELINE.csv")
if [r.get("wave_id", "") for r in seq] != expected:
    err("implementation sequence baseline does not exactly mirror canonical wave authority")
for n, r in enumerate(seq, start=1):
    if r.get("sequence") != str(n): err(f"{r.get('wave_id')}: incorrect sequence number")
    if r.get("accountable_owner") != "Project Manager": err(f"{r.get('wave_id')}: owner is not Project Manager")
    if r.get("baseline_status") != "BASELINED": err(f"{r.get('wave_id')}: row not BASELINED")
    if r.get("wip_limit") != "1": err(f"{r.get('wave_id')}: WIP limit must be 1")
    if r.get("calendar_timeline_policy") != "NO_CALENDAR_TIMELINE_BASELINED": err(f"{r.get('wave_id')}: timeline policy mismatch")
    forbidden_columns = {"planned_start", "planned_finish", "start_date", "finish_date", "deadline", "duration", "planned_focus_days", "planned_focus_hours", "effort_hours"}
    if forbidden_columns.intersection(r.keys()): err("timeline/effort columns must not exist in IMPLEMENTATION_SEQUENCE_BASELINE.csv")

legacy = rows(I / "IMPLEMENTATION_WAVES.csv")
if [r.get("wave_id", "") for r in legacy] != expected:
    err("08-implementation-plans/IMPLEMENTATION_WAVES.csv conflicts with final wave authority")
if any(r.get("accountable_owner") != "Project Manager" for r in legacy):
    err("implementation plan wave ownership must be Project Manager")
if any(r.get("calendar_timeline_policy") != "NO_CALENDAR_TIMELINE_BASELINED" for r in legacy):
    err("implementation plan must preserve no-timeline policy")

costs = rows(R / "PROJECT_COST_BASELINE.csv")
if not costs: err("project cost baseline is empty")
for r in costs:
    if r.get("accountable_owner") != "Project Manager": err(f"{r.get('cost_id')}: cost owner is not Project Manager")
    try:
        if float(r.get("authorized_amount_inr", "")) < 0: err(f"{r.get('cost_id')}: negative authorized amount")
    except ValueError:
        err(f"{r.get('cost_id')}: authorized_amount_inr must be numeric")
    if r.get("approval_status") not in {"NOT_AUTHORIZED_UNTIL_CHANGE", "BASELINED"}: err(f"{r.get('cost_id')}: invalid approval_status")

stakeholders = rows(R / "STAKEHOLDER_REGISTER.csv")
if not stakeholders: err("stakeholder register is empty")
if any(r.get("accountable_owner") != "Project Manager" for r in stakeholders):
    err("all stakeholder engagement accountability must remain with Project Manager")

raid = rows(P / "RAID_REGISTER.csv")
if not raid: err("RAID register is empty")
if any(r.get("owner") != "Project Manager" for r in raid):
    err("all current RAID ownership must be Project Manager")
raid_by_id = {r.get("raid_id"): r for r in raid}
for rid, status in {"R-001":"Closed", "R-002":"Closed", "R-003":"Closed", "A-001":"Confirmed", "D-001":"Satisfied"}.items():
    if raid_by_id.get(rid, {}).get("status") != status: err(f"{rid}: stale status; expected {status}")

sole = (P / "SOLE_PROJECT_MANAGER_OPERATING_MODEL.md").read_text(encoding="utf-8") if (P / "SOLE_PROJECT_MANAGER_OPERATING_MODEL.md").exists() else ""
if "Sole accountable human role: `Project Manager`" not in sole:
    err("sole-PM accountability statement missing")

closure = (P / "PLANNING_CLOSURE_STATUS.md").read_text(encoding="utf-8") if (P / "PLANNING_CLOSURE_STATUS.md").exists() else ""
if "Planning is **COMPLETE**" not in closure:
    err("planning closure status is not current/complete")
checkpoint = (P / "CURRENT_REBUILD_CHECKPOINT.md").read_text(encoding="utf-8") if (P / "CURRENT_REBUILD_CHECKPOINT.md").exists() else ""
for stale in ("All 510 canonical feature dossiers remain intentionally `UNSPECIFIED`", "Architecture freeze is **BLOCKED**"):
    if stale in checkpoint: err("current checkpoint contains stale statement: " + stale)
for marker in ("PLANNING CLOSURE: PASS", "ARCHITECTURE FREEZE: PASS", "IMPLEMENTATION AUTHORIZATION: PASS", "PM PLANNING BASELINE: PASS"):
    if marker not in checkpoint: err("current checkpoint missing " + marker)

# Explicit guard against the discarded timeline-based installer or any silent reintroduction.
if (R / "PROJECT_SCHEDULE_BASELINE.csv").exists(): err("PROJECT_SCHEDULE_BASELINE.csv must not exist under the no-timeline baseline")
if (P / "PROJECT_SCHEDULE_BASELINE.md").exists(): err("PROJECT_SCHEDULE_BASELINE.md must not exist under the no-timeline baseline")

no_timeline_files = [
    P / "SOLE_PROJECT_MANAGER_OPERATING_MODEL.md",
    P / "PROJECT_CAPACITY_PLAN.md",
    P / "SCHEDULE_MANAGEMENT_POLICY.md",
    P / "PM_PLANNING_BASELINE.md",
    P / "CURRENT_REBUILD_CHECKPOINT.md",
    P / "PLANNING_CLOSURE_STATUS.md",
    R / "IMPLEMENTATION_SEQUENCE_BASELINE.csv",
    R / "PM_PLANNING_BASELINE_REVIEW.csv",
    I / "IMPLEMENTATION_WAVES.csv",
]
iso_date = re.compile(r"\b20\d{2}-\d{2}-\d{2}\b")
for p in no_timeline_files:
    if p.exists():
        text = p.read_text(encoding="utf-8-sig", errors="replace")
        if iso_date.search(text): err(f"{p.relative_to(ROOT)} contains a calendar date under no-timeline policy")
        for token in ("planned_start", "planned_finish", "planned_focus_days", "planned_focus_hours", "hours/week", "hours/day", "long-range forecast"):
            if token in text: err(f"{p.relative_to(ROOT)} contains forbidden timeline/effort token: {token}")

cc = (P / "CHANGE_CONTROL.md").read_text(encoding="utf-8").lower() if (P / "CHANGE_CONTROL.md").exists() else ""
if "founder approval" in cc:
    err("current change control still assigns approval to a non-PM role")

if errors:
    print("PM PLANNING VALIDATION FAILED")
    for e in errors[:100]: print(" -", e)
    sys.exit(1)
print("PM PLANNING VALIDATION PASSED")
print(" - sole accountable human role: Project Manager")
print(" - one canonical T00/T01/W01-W15 dependency sequence")
print(" - calendar timeline: intentionally NOT baselined")
print(" - no dates, deadlines, duration or effort-hour baseline")
print(" - cost, stakeholder, communications and procurement controls present")
print(" - current checkpoint and RAID reconciled")
