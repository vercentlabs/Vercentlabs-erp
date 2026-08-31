#!/usr/bin/env python3
from pathlib import Path
import csv,sys,re
ROOT=Path(__file__).resolve().parents[2];D=ROOT/'docs';R=D/'02-register';errors=[]
def err(x):errors.append(x)
req=[D/'00-program/IMPLEMENTATION_MASTER_PLAN.md',D/'00-program/MASTER_WBS.md',D/'00-program/MILESTONE_PLAN.md',D/'00-program/RAID_REGISTER.csv',D/'08-implementation-plans/IMPLEMENTATION_WAVES.csv',D/'08-implementation-plans/MIGRATION_CUTOVER_PLAN.md',D/'08-implementation-plans/RELEASE_ROLLBACK_PLAN.md',D/'08-implementation-plans/PILOT_HYPERCARE_PLAN.md',D/'01-standards/TENANT_TRANSACTION_RLS_STANDARD.md',D/'01-standards/OPERATIONAL_RESILIENCE_STANDARD.md',D/'01-standards/AI_RUNTIME_GOVERNANCE.md',D/'04-shared-platform/EXPERIENCE_KERNEL.md',R/'TEST_TRACEABILITY_REGISTER.csv',R/'SEMANTIC_REVIEW_REGISTER.csv']
for p in req:
    if not p.exists():err('missing '+str(p.relative_to(ROOT)))
# journey docs must now be ready and semantically include critical controls
for p in (D/'05-cross-module').glob('*.md'):
    if p.name in {'README.md'}:continue
    if p.name in {'LEAD_TO_CASH.md','ORDER_TO_CASH.md','PROCURE_TO_PAY.md','PLAN_TO_PRODUCE.md','MANUFACTURING_QUALITY_STOCK.md','POS_TO_CASH.md','HIRE_TO_PAYROLL_TO_BOOKS.md','ASSET_TO_BOOKS.md','PROJECT_TO_CASH.md','SERVICE_TO_RESOLUTION.md'}:
        t=p.read_text(encoding='utf-8').lower()
        for token in ['status: `specification_ready`','idempotency','reversal','reconciliation','transaction','authorization','e2e','uat']:
            if token not in t:err(f'{p.name}: missing {token}')
# critical requirements test planning
with (R/'SUBREQUIREMENT_REGISTER.csv').open(encoding='utf-8',newline='') as f:subs=list(csv.DictReader(f))
crit={'FR','BR','VAL','CALC','SEC','INT','API','PERF','OBS','E2E','UAT'}
blank=[r['requirement_id'] for r in subs if r.get('requirement_type') in crit and not (r.get('test_ids') or '').strip()]
if blank:err(f'{len(blank)} critical requirements still lack test_ids')
with (R/'TEST_TRACEABILITY_REGISTER.csv').open(encoding='utf-8',newline='') as f:tests=list(csv.DictReader(f))
tids={r['test_id'] for r in tests}
for r in subs:
    if r.get('requirement_type') in crit:
        for tid in (r.get('test_ids') or '').split(';'):
            if tid and tid not in tids:err(f'{r["requirement_id"]}: unresolved test id {tid}')
if errors:
 print('PLANNING CLOSURE VALIDATION FAILED');[print(' -',x) for x in errors[:100]];sys.exit(1)
print('PLANNING CLOSURE VALIDATION PASSED')
print(' - PM implementation plan/WBS/waves/RAID present')
print(' - architecture/DR/Experience/AI standards present')
print(' - enterprise journey semantics present')
print(' - critical requirements have planned test traceability')
